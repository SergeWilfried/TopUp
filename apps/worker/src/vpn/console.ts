import { now, type Env } from '../env';
import { agent, loadServer } from './agent';
import type { PeerRow } from './peers';
import { regenerate } from './peers';
import type { User } from './auth';

/**
 * Read models for the admin console, served from D1.
 *
 * A "subscription" is a user row that has ever been granted time. Peers are
 * folded in so the console can show devices and installed locations without a
 * second round trip.
 */
export type SubscriptionRow = {
  id: string;
  email: string;
  plan: string;
  startedAt: number | null;
  expiresAt: number;
  locations: string[];
  devices: number;
  status: 'active' | 'expiring' | 'lapsed';
};

const DAY = 86_400_000;

export const statusOf = (expiresAt: number, t = now()): SubscriptionRow['status'] => {
  const daysLeft = (expiresAt - t) / DAY;
  return daysLeft < 0 ? 'lapsed' : daysLeft <= 7 ? 'expiring' : 'active';
};

type Joined = {
  id: string;
  email: string;
  plan: string | null;
  sub_started_at: number | null;
  sub_expires_at: number;
  locations: string | null;
  devices: number;
};

/**
 * Every subscription with its peers rolled up.
 *
 * The console's filtering, sorting and pagination run over this array via the
 * shared query layer. That is fine at the scale a single operator browses; if
 * the account count grows past a few thousand this should become a SQL
 * LIMIT/OFFSET with the filters pushed down.
 */
export async function listSubscriptions(env: Env): Promise<SubscriptionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.plan, u.sub_started_at, u.sub_expires_at,
            GROUP_CONCAT(p.server_id) AS locations,
            COUNT(p.public_key)       AS devices
     FROM users u
     LEFT JOIN peers p ON p.user_id = u.id AND p.state = 'active'
     WHERE u.sub_expires_at IS NOT NULL
     GROUP BY u.id
     ORDER BY u.sub_expires_at ASC`,
  ).all<Joined>();

  const t = now();
  return results.map((r) => ({
    id: r.id,
    email: r.email,
    plan: r.plan ?? 'Unknown plan',
    startedAt: r.sub_started_at,
    expiresAt: r.sub_expires_at,
    // GROUP_CONCAT gives a comma string, and NULL when the user has no peers.
    locations: r.locations ? r.locations.split(',') : [],
    devices: r.devices,
    status: statusOf(r.sub_expires_at, t),
  }));
}

export async function getSubscription(env: Env, id: string): Promise<SubscriptionRow | null> {
  const all = await listSubscriptions(env);
  return all.find((s) => s.id === id) ?? null;
}

export async function installsByLocation(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id AS code, s.name, s.host,
            COUNT(p.public_key) AS installs
     FROM servers s
     LEFT JOIN peers p ON p.server_id = s.id AND p.state = 'active'
     WHERE s.active = 1
     GROUP BY s.id
     ORDER BY installs DESC, s.name`,
  ).all<{ code: string; name: string; host: string; installs: number }>();
  return results;
}

/** Extends a subscription. Same rule the customer path uses. */
export async function extendSubscription(env: Env, id: string, days: number) {
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!user) return null;

  // From whichever is later — a lapsed customer gets no free backdating.
  const base = Math.max(user.sub_expires_at ?? 0, now());
  await env.DB.prepare(`UPDATE users SET sub_expires_at = ? WHERE id = ?`)
    .bind(base + days * DAY, id)
    .run();

  // Bring back anything the expiry sweep switched off.
  const { results } = await env.DB.prepare(
    `SELECT * FROM peers WHERE user_id = ? AND enabled = 0 AND state = 'active'`,
  )
    .bind(id)
    .all<PeerRow>();
  for (const peer of results) {
    try {
      const server = await loadServer(env, peer.server_id);
      if (!server) continue;
      await agent(env, server, 'PATCH', `/peers/${encodeURIComponent(peer.public_key)}`, { enabled: true });
      await env.DB.prepare(`UPDATE peers SET enabled = 1 WHERE public_key = ?`)
        .bind(peer.public_key)
        .run();
    } catch (e) {
      console.error(`admin extend: re-enable failed for ${peer.public_key}: ${(e as Error).message}`);
    }
  }

  return getSubscription(env, id);
}

/**
 * Re-issues every tunnel on an account.
 *
 * There is no "resend": the config carries a private key that is generated on
 * the agent and handed to the customer once, deliberately never stored. Support
 * can only mint new keys — which invalidates whatever is installed today, so
 * the caller must warn before doing it.
 */
export async function regenerateAll(env: Env, id: string) {
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!user) return null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM peers WHERE user_id = ? AND state = 'active'`,
  )
    .bind(id)
    .all<PeerRow>();

  const issued: { location: string; publicKey: string; conf: string }[] = [];
  const failed: string[] = [];
  for (const peer of results) {
    const result = await regenerate(env, user, peer.public_key);
    if ('error' in result) failed.push(peer.server_id);
    else issued.push({ location: peer.server_id, publicKey: result.publicKey, conf: result.conf });
  }
  return { email: user.email, issued, failed };
}
