import { days, now, randHex, sha256, timingSafeEqual, type Env } from '../env';
import { liveSendBlocked, sendSms, smsConfigured } from './twilio';
import { checkVerification, startVerification, verifyConfigured } from './verify';
import { canonicalMsisdn, toE164 } from '@topup/core';

export type User = {
  id: string;
  email: string | null;
  msisdn: string | null;
  is_staff: number;
  stripe_customer_id: string | null;
  sub_expires_at: number | null;
  created_at: number;
};

/** How a code was requested, and therefore which column identifies the user. */
export type Channel = 'email' | 'sms';
export const columnFor = (channel: Channel) => (channel === 'sms' ? 'msisdn' : 'email');

export const isStaff = (user: User) => user.is_staff === 1;

/** Digits only, so `07 09 55 12 34` and `+225 0709551234` are one identity. */
/**
 * Canonical account identity.
 *
 * E.164 digits without the plus, so one handset is one account however the
 * customer types it. The previous version stripped punctuation and leading
 * zeros only, which meant `56284997` and `22656284997` — the same phone —
 * became two accounts with separate orders, points and subscriptions.
 *
 * Returns null when the number cannot be resolved; callers must reject rather
 * than fall back to a looser form, or the split comes straight back.
 */
export const normaliseMsisdn = (raw: string, country?: string | null): string | null =>
  canonicalMsisdn(raw, country ?? undefined);

const OTP_TTL = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 3;
const OTP_SEND_WINDOW = 15 * 60_000;
const SESSION_TTL = days(90);

/** A subscription is live only while its expiry is in the future. */
export const isActive = (user: User) => user.sub_expires_at !== null && user.sub_expires_at > now();

export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  // The column holds a hash, so a leaked database yields nothing replayable.
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<User>();
  return row ?? null;
}

export type OtpResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Issues a challenge. Resends are throttled per address so the endpoint cannot
 * be used to bomb an inbox or burn the email budget, and the code is stored
 * hashed so the table is not a list of live credentials.
 */
export async function requestOtp(
  env: Env,
  identifier: string,
  channel: Channel,
): Promise<OtpResult & { code?: string; delegated?: boolean }> {
  const t = now();
  const existing = await env.DB.prepare(
    `SELECT send_count, window_started_at FROM otp_codes WHERE identifier = ?`,
  )
    .bind(identifier)
    .first<{ send_count: number; window_started_at: number }>();

  let sendCount = 1;
  let windowStart = t;
  if (existing && t - existing.window_started_at < OTP_SEND_WINDOW) {
    if (existing.send_count >= OTP_MAX_SENDS) {
      return { ok: false, error: 'too_many_requests', status: 429 };
    }
    sendCount = existing.send_count + 1;
    windowStart = existing.window_started_at;
  }

  /**
   * When Twilio Verify owns SMS we generate nothing — but the throttle above
   * still runs, and deliberately so: each verification is a billable call, so
   * an unthrottled endpoint is a way to spend our money, not just to annoy a
   * customer. The row below then records only the send count.
   */
  const delegated = channel === 'sms' && verifyConfigured(env);
  const code = delegated
    ? null
    : String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await env.DB.prepare(
    `INSERT INTO otp_codes (identifier, channel, code_hash, expires_at, attempts, send_count, window_started_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       channel = excluded.channel,
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       send_count = excluded.send_count,
       window_started_at = excluded.window_started_at`,
  )
    .bind(
      identifier,
      channel,
      // Nothing verifiable is stored for a delegated code; the row exists only
      // to carry the send counter.
      code ? await sha256(code) : '',
      t + OTP_TTL,
      sendCount,
      windowStart,
    )
    .run();

  return { ok: true, code: code ?? undefined, delegated };
}

export type VerifyResult =
  | { ok: true; token: string; user: User }
  | { ok: false; error: string; status: number };

/**
 * Consumes a challenge.
 *
 * Attempts are counted and the row is destroyed once exhausted: six digits is
 * only 10^6, and the previous version allowed unlimited parallel guesses.
 */
export async function verifyOtp(
  env: Env,
  identifier: string,
  code: string,
  channel: Channel,
): Promise<VerifyResult> {
  const t = now();

  // Twilio holds the code for SMS, so there is nothing local to compare. It
  // also counts attempts and expires the code, which is why no attempt
  // bookkeeping happens on this path.
  if (channel === 'sms' && verifyConfigured(env)) {
    const outcome = await checkVerification(env, `+${identifier}`, code);
    if (!outcome.approved) {
      // Wrong, expired and spent are all one answer to the customer: saying
      // which would reveal whether a live code exists for that number.
      if (outcome.reason === 'unreachable' || outcome.reason === 'not_configured') {
        return { ok: false, error: 'verification_unavailable', status: 503 };
      }
      return { ok: false, error: 'invalid_code', status: 401 };
    }
    await env.DB.prepare(`DELETE FROM otp_codes WHERE identifier = ?`).bind(identifier).run();
    return await establishSession(env, identifier, channel);
  }

  const row = await env.DB.prepare(
    `SELECT code_hash, expires_at, attempts FROM otp_codes WHERE identifier = ?`,
  )
    .bind(identifier)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();

  if (!row) return { ok: false, error: 'invalid_code', status: 401 };

  if (row.expires_at <= t || row.attempts >= OTP_MAX_ATTEMPTS) {
    await env.DB.prepare(`DELETE FROM otp_codes WHERE identifier = ?`).bind(identifier).run();
    return { ok: false, error: 'invalid_code', status: 401 };
  }

  if (!timingSafeEqual(row.code_hash, await sha256(code))) {
    const attempts = row.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await env.DB.prepare(`DELETE FROM otp_codes WHERE identifier = ?`).bind(identifier).run();
    } else {
      await env.DB.prepare(`UPDATE otp_codes SET attempts = ? WHERE identifier = ?`)
        .bind(attempts, identifier)
        .run();
    }
    return { ok: false, error: 'invalid_code', status: 401 };
  }

  await env.DB.prepare(`DELETE FROM otp_codes WHERE identifier = ?`).bind(identifier).run();

  return await establishSession(env, identifier, channel);
}

/**
 * Finds or creates the account and mints a session.
 *
 * Split out because proving a number now happens two ways — locally for email,
 * and at Twilio for SMS — and both must arrive at exactly the same account
 * linking and session. Duplicating it is how the two paths drift apart.
 */
async function establishSession(env: Env, identifier: string, channel: Channel): Promise<VerifyResult> {
  const t = now();
  const column = columnFor(channel);
  let user = await env.DB.prepare(`SELECT * FROM users WHERE ${column} = ?`)
    .bind(identifier)
    .first<User>();

  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users (id, ${column}, created_at) VALUES (?, ?, ?)`)
      .bind(id, identifier, t)
      .run();
    user = {
      id,
      email: channel === 'email' ? identifier : null,
      msisdn: channel === 'sms' ? identifier : null,
      is_staff: 0,
      stripe_customer_id: null,
      sub_expires_at: null,
      created_at: t,
    };
  }

  // Tie the telco profile to the account so orders placed from the handset and
  // a VPN bought by email belong to one person.
  if (channel === 'sms') {
    await env.DB.prepare(`UPDATE customers SET vpn_user_id = ? WHERE msisdn = ? AND vpn_user_id IS NULL`)
      .bind(user.id, identifier)
      .run();
  }

  const token = randHex(32);
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(await sha256(token), user.id, t + SESSION_TTL, t)
    .run();

  return { ok: true, token, user };
}

/** Revokes the presented session — the previous version had no way out. */
export async function signOut(req: Request, env: Env) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

/** Delivery. Never log the code outside local development. */
/**
 * Delivers a login code.
 *
 * Returns the outcome instead of swallowing it. A provider failure is an
 * infrastructure fault, not a signal about whether the account exists, so the
 * caller can surface it without leaking anything — and a customer staring at a
 * code screen that will never receive a code is worse than an honest error.
 */
export async function sendOtp(
  env: Env,
  identifier: string,
  code: string,
  channel: Channel,
  opts: { raw?: string; country?: string | null } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (channel === 'sms') return sendOtpSms(env, identifier, code, opts);
  return sendOtpEmail(env, identifier, code);
}

/**
 * SMS delivery. Unimplemented: this needs an aggregator with West African
 * coverage. Until then a phone login only works in development, where the code
 * is logged.
 */
async function sendOtpSms(
  env: Env,
  msisdn: string,
  code: string,
  opts: { raw?: string; country?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The identifier is already canonical E.164 digits, so this is a formatting
  // step rather than a reconstruction — the country was resolved at identify().
  const to = toE164(opts.raw ?? msisdn, opts.country ?? env.SMS_DEFAULT_COUNTRY ?? 'BF');
  if (!to) return { ok: false, error: 'msisdn_unroutable' };

  // Verify sends its own message. Sending ours too would deliver two different
  // codes for one login, and only one of them would work.
  if (verifyConfigured(env)) {
    const started = await startVerification(env, to, 'sms');
    if (!started.ok) {
      console.error(`Verify start failed: ${started.error}`);
      return { ok: false, error: started.error };
    }
    return { ok: true };
  }

  // Printing a live code is only ever acceptable off production, and only when
  // nothing could have delivered it. Testing for a missing account SID was too
  // narrow: a half-filled Twilio config — an account but no sender — skipped
  // the log and then failed to send, breaking local sign-in entirely.
  // Nothing can deliver: either no provider, or live sending is blocked.
  if (!smsConfigured(env) || liveSendBlocked(env)) {
    console.log(`[dev] OTP for ${to}: ${code}`);
    return { ok: true };
  }

  const result = await sendSms(env, to, `TOPUP: ${code} is your code. It expires in 10 minutes.`);
  if (!result.ok) {
    // Never log the code itself, only why delivery failed.
    console.error(`SMS OTP delivery failed: ${result.error}`);
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

async function sendOtpEmail(
  env: Env,
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.RESEND_API_KEY) {
    // Only print a live code when nothing could have delivered it, and never
    // on production regardless.
    if (env.ENVIRONMENT !== 'production') {
      console.log(`[dev] OTP for ${email}: ${code}`);
      return { ok: true };
    }
    console.error('OTP requested but no email provider is configured');
    return { ok: false, error: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'TOPUP <login@smtp.resend.com>',
        to: email,
        subject: `${code} is your TOPUP code`,
        text: `Your code is ${code}. It expires in 10 minutes.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    // fetch does not throw on 4xx, and the previous `.catch()` swallowed
    // everything else — so a rejected send reported success and the customer
    // waited for an email that was never accepted.
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error(`OTP email rejected: ${res.status} ${body.message ?? ''}`);
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`OTP email failed: ${(e as Error).message}`);
    return { ok: false, error: 'unreachable' };
  }
}
