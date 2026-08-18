import { now, isEmail, type Env } from './env';

/**
 * Staff accounts and the state of the front door.
 *
 * Both halves of this file exist because of the same afternoon. There was no
 * way to create the first staff account — `is_staff` is hard-coded to 0 at
 * sign-up and nothing else ever wrote it — so every /admin route returned 401
 * to everyone, and the fix was a hand-written UPDATE against production D1.
 * Then the account that was finally created could not sign in, because no OTP
 * channel is configured on the deployed worker and nothing anywhere said so.
 *
 * A console that cannot answer "who has access" and "can they actually get
 * in" is a console that sends its operator to the database.
 */

export type StaffRow = {
  id: string;
  email: string | null;
  msisdn: string | null;
  createdAt: number;
  /** Unexpired sessions. Zero means they have never successfully signed in. */
  sessions: number;
  /** When the newest of those was issued — the closest thing to "last seen". */
  lastSignIn: number | null;
  /** True for the account making this request, which may not lock itself out. */
  isSelf: boolean;
};

export async function listStaff(env: Env, selfId: string): Promise<{ rows: StaffRow[] }> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.msisdn, u.created_at AS createdAt,
            COUNT(s.token_hash) AS sessions,
            MAX(s.created_at) AS lastSignIn
     FROM users u
     LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
     WHERE u.is_staff = 1
     GROUP BY u.id
     ORDER BY u.created_at`,
  )
    .bind(now())
    .all<Omit<StaffRow, 'isSelf'>>();

  return { rows: results.map((r) => ({ ...r, isSelf: r.id === selfId })) };
}

export type StaffResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/**
 * Grants staff access to an email address, creating the account if needed.
 *
 * Creating the row up front rather than waiting for a first sign-in is what
 * makes this usable: the OTP flow looks an account up by identifier and reuses
 * it, so the invitee simply signs in and is already staff. The alternative —
 * "ask them to log in once, then come back and promote them" — is the workflow
 * that had nobody able to log in at all.
 */
export async function grantStaff(env: Env, emailRaw: unknown): Promise<StaffResult<{ id: string; created: boolean }>> {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!isEmail(email)) return { ok: false, error: 'email_invalid', status: 400 };

  const existing = await env.DB.prepare(`SELECT id, is_staff FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string; is_staff: number }>();

  if (existing) {
    if (existing.is_staff === 1) return { ok: false, error: 'already_staff', status: 409 };
    await env.DB.prepare(`UPDATE users SET is_staff = 1 WHERE id = ?`).bind(existing.id).run();
    return { ok: true, data: { id: existing.id, created: false } };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users (id, email, is_staff, created_at) VALUES (?, ?, 1, ?)`)
    .bind(id, email, now())
    .run();
  return { ok: true, data: { id, created: true } };
}

/**
 * Removes staff access.
 *
 * Refusing self-revocation is the whole lockout guard, and it is sufficient:
 * the caller has already passed the staff gate, so at least one staff account
 * exists at every moment, and the one account nobody can remove is the one
 * making the request. A separate "last account" check reads as prudent and can
 * never fire — if only one account has access it is this one, and any other id
 * is simply not staff.
 *
 * That matters because the alternative is where this console started: every
 * /admin route returning 401 to everybody, recoverable only by hand-editing
 * production D1.
 *
 * Sessions go with the flag. A revoked operator holding a valid bearer token
 * for the rest of its ninety days is not revoked.
 */
export async function revokeStaff(env: Env, id: string, selfId: string): Promise<StaffResult<{ id: string }>> {
  if (id === selfId) return { ok: false, error: 'cannot_revoke_self', status: 409 };

  const row = await env.DB.prepare(`SELECT id FROM users WHERE id = ? AND is_staff = 1`)
    .bind(id)
    .first<{ id: string }>();
  if (!row) return { ok: false, error: 'not_found', status: 404 };

  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET is_staff = 0 WHERE id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
  ]);
  return { ok: true, data: { id } };
}

/** Ends every session for one account without touching its access. */
export async function revokeSessions(env: Env, id: string): Promise<{ revoked: number }> {
  const res = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id).run();
  return { revoked: res.meta.changes ?? 0 };
}

export type SecurityState = {
  /** How a sign-in code can actually reach someone. */
  channels: { email: boolean; sms: boolean };
  /** Set means VPN endpoints can mint agent tokens. */
  agentSigningKey: boolean;
  liveSmsAllowed: boolean;
  environment: string;
  staffCount: number;
  activeSessions: number;
};

/**
 * Whether the front door works — booleans only, never a secret's value.
 *
 * Every one of these was false in production while the console showed a
 * perfectly healthy dashboard. An operator locked out by a missing API key
 * deserves to be told which key.
 */
export async function securityState(env: Env): Promise<SecurityState> {
  const staff = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_staff = 1`).first<{ n: number }>();
  const sessions = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?`)
    .bind(now())
    .first<{ n: number }>();

  return {
    channels: {
      email: Boolean(env.RESEND_API_KEY),
      sms: Boolean(env.TWILIO_VERIFY_SERVICE_SID || (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)),
    },
    agentSigningKey: Boolean(env.AGENT_SIGNING_KEY),
    liveSmsAllowed: env.ALLOW_LIVE_SMS === '1',
    environment: env.ENVIRONMENT ?? 'unknown',
    staffCount: staff?.n ?? 0,
    activeSessions: sessions?.n ?? 0,
  };
}
