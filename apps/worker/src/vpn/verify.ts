import type { Env } from '../env';
import { liveSendBlocked } from './twilio';

/**
 * Twilio Verify — Twilio owns the whole code lifecycle.
 *
 * It generates the code, sends it, expires it, counts attempts and checks it.
 * We store nothing: no hash, no expiry, no attempt counter. What we keep is the
 * session we mint *after* Twilio says the number is proven, which is the only
 * part that is ours.
 *
 * Two behaviours drive the error handling:
 *
 *  1. **A wrong code is a 200.** The verification stays `pending` with
 *     `valid: false`. Reading `res.ok` as success would log anybody in.
 *  2. **A finished verification is a 404.** Twilio deletes the record once it
 *     is approved, expires, or hits max attempts — so the honest reading of a
 *     404 here is "that code is spent", not "the network failed".
 */

const BASE = 'https://verify.twilio.com/v2';

const hasVerifyCredentials = (env: Env) =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);

/**
 * Whether Twilio actually owns the code for this run.
 *
 * Credentials alone are not enough: if live sending is blocked, delegating
 * would generate no local code and send nothing, leaving no way to sign in at
 * all. So a blocked run falls back to the local code it can print.
 */
export const verifyConfigured = (env: Env) => hasVerifyCredentials(env) && !liveSendBlocked(env);

const base = (env: Env) => env.TWILIO_VERIFY_BASE_URL ?? BASE;

const auth = (env: Env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;

/** Twilio's terminal states, plus the ones we derive from transport. */
export type StartResult = { ok: true; status: string } | { ok: false; error: string };

/**
 * Asks Twilio to send a code.
 *
 * `channel` is 'sms' here; Verify also does voice and WhatsApp, which is the
 * upgrade path when SMS deliverability is poor in a market.
 */
export async function startVerification(
  env: Env,
  to: string,
  channel: 'sms' | 'call' | 'whatsapp' = 'sms',
): Promise<StartResult> {
  if (!verifyConfigured(env)) return { ok: false, error: 'not_configured' };
  // Same guard as SMS: a dev run must not start a billable verification against
  // live Twilio just because the credentials happen to be present.
  if (liveSendBlocked(env)) return { ok: false, error: 'live_send_blocked_in_dev' };

  try {
    const res = await fetch(
      `${base(env)}/Services/${encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID!)}/Verifications`,
      {
        method: 'POST',
        headers: { authorization: auth(env), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, Channel: channel }).toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok) {
      // 60200 invalid parameter, 60203 max send attempts, 20404 bad service sid,
      // 20429 rate limited. The number is what makes a support ticket short.
      return { ok: false, error: data.code ? `twilio_${data.code}` : `http_${res.status}` };
    }
    return { ok: true, status: data.status ?? 'pending' };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}

export type CheckResult =
  | { approved: true }
  | { approved: false; reason: 'wrong_code' | 'spent' | 'not_configured' | 'unreachable' | string };

/**
 * Checks a code.
 *
 * Only `status === 'approved'` is a pass. Everything else — a pending
 * verification with the wrong digits, an expired one, a deleted one — is a
 * refusal, and the caller must not distinguish them to the customer beyond
 * "wrong or expired", because saying which reveals whether a code was live.
 */
export async function checkVerification(env: Env, to: string, code: string): Promise<CheckResult> {
  if (!verifyConfigured(env)) return { approved: false, reason: 'not_configured' };

  try {
    const res = await fetch(
      `${base(env)}/Services/${encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID!)}/VerificationCheck`,
      {
        method: 'POST',
        headers: { authorization: auth(env), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, Code: code }).toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    // Twilio deletes a verification once it is approved, expired, or out of
    // attempts, and answers 404 from then on. That is a spent code, not a
    // failed request — reporting it as a network error would be a lie.
    if (res.status === 404) return { approved: false, reason: 'spent' };

    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      valid?: boolean;
      code?: number;
    };

    if (!res.ok) return { approved: false, reason: data.code ? `twilio_${data.code}` : `http_${res.status}` };

    // `valid` is documented as legacy, so `status` is the authority.
    if (data.status === 'approved') return { approved: true };
    if (data.status === 'max_attempts_reached' || data.status === 'expired' || data.status === 'canceled') {
      return { approved: false, reason: 'spent' };
    }
    return { approved: false, reason: 'wrong_code' };
  } catch (e) {
    return { approved: false, reason: 'unreachable' };
  }
}
