import { agent, loadServer, type CreatedPeer, type Server } from './agent';
import { now, type Env } from '../env';
import type { User } from './auth';

export type PeerRow = {
  public_key: string;
  user_id: string;
  server_id: string;
  address: string | null;
  enabled: number;
  state: string;
  created_at: number;
};

export type Issued = { publicKey: string; address: string; conf: string };
export type PeerError = { error: string; status: number };
export const isError = (v: unknown): v is PeerError =>
  typeof v === 'object' && v !== null && 'error' in v;

/**
 * Takes a device slot atomically.
 *
 * The check-then-insert this replaces was a TOCTOU: two concurrent requests
 * both read a count of 2 and both inserted. Here the limit is enforced *inside*
 * the INSERT, so SQLite decides, and a placeholder row holds the slot while the
 * agent call is in flight.
 */
async function reserveSlot(env: Env, user: User, serverId: string): Promise<string | null> {
  const placeholder = `reserving:${crypto.randomUUID()}`;
  const limit = Number(env.DEVICE_LIMIT ?? 3);

  const res = await env.DB.prepare(
    `INSERT INTO peers (public_key, user_id, server_id, address, enabled, state, created_at)
     SELECT ?, ?, ?, NULL, 1, 'reserving', ?
     WHERE (SELECT COUNT(*) FROM peers
            WHERE user_id = ? AND server_id = ? AND state IN ('reserving','active')) < ?`,
  )
    .bind(placeholder, user.id, serverId, now(), user.id, serverId, limit)
    .run();

  return res.meta.changes === 1 ? placeholder : null;
}

/**
 * Creates a tunnel and hands the config back exactly once.
 *
 * If the agent succeeds but the database write does not, the peer is deleted
 * from the agent again — otherwise it lingers on the VPS uncounted, never
 * disabled on expiry and invisible to the customer.
 */
export async function provision(
  env: Env,
  user: User,
  serverId: unknown,
): Promise<Issued | PeerError> {
  if (typeof serverId !== 'string' || !serverId) return { error: 'server_required', status: 400 };

  const server = await loadServer(env, serverId);
  if (!server) return { error: 'unknown_server', status: 404 };

  const placeholder = await reserveSlot(env, user, serverId);
  if (!placeholder) return { error: 'device_limit', status: 409 };

  let created: CreatedPeer;
  try {
    created = await agent<CreatedPeer>(env, server, 'POST', '/peers', { label: user.email });
  } catch (e) {
    await env.DB.prepare(`DELETE FROM peers WHERE public_key = ?`).bind(placeholder).run();
    console.error(`provision failed for ${user.id}: ${(e as Error).message}`);
    return { error: 'provision_failed', status: 502 };
  }

  try {
    await env.DB.prepare(
      `UPDATE peers SET public_key = ?, address = ?, state = 'active' WHERE public_key = ?`,
    )
      .bind(created.publicKey, created.address, placeholder)
      .run();
  } catch (e) {
    // Record what exists on the box so the sweep can remove it, then undo now.
    await env.DB.prepare(
      `UPDATE peers SET public_key = ?, address = ?, state = 'pending_delete' WHERE public_key = ?`,
    )
      .bind(created.publicKey, created.address, placeholder)
      .run()
      .catch(() => {});
    await agent(env, server, 'DELETE', `/peers/${encodeURIComponent(created.publicKey)}`).catch(() => {});
    console.error(`provision write failed for ${user.id}: ${(e as Error).message}`);
    return { error: 'provision_failed', status: 500 };
  }

  return { publicKey: created.publicKey, address: created.address, conf: created.conf };
}

/**
 * Replaces a tunnel's keys.
 *
 * Order matters: the previous version deleted first, so a failure to create the
 * replacement left the customer with no peer at all and no record of one. The
 * new peer is established before the old one is torn down.
 */
export async function regenerate(
  env: Env,
  user: User,
  publicKey: unknown,
): Promise<Issued | PeerError> {
  if (typeof publicKey !== 'string' || !publicKey) return { error: 'public_key_required', status: 400 };

  const peer = await env.DB.prepare(
    `SELECT * FROM peers WHERE public_key = ? AND user_id = ? AND state = 'active'`,
  )
    .bind(publicKey, user.id)
    .first<PeerRow>();
  if (!peer) return { error: 'not_found', status: 404 };

  const server = await loadServer(env, peer.server_id);
  if (!server) return { error: 'unknown_server', status: 404 };

  let created: CreatedPeer;
  try {
    created = await agent<CreatedPeer>(env, server, 'POST', '/peers', { label: user.email });
  } catch (e) {
    console.error(`regenerate create failed for ${user.id}: ${(e as Error).message}`);
    return { error: 'provision_failed', status: 502 };
  }

  // Insert the replacement and mark the old row for teardown in one transaction,
  // so the pair can never be half-applied.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO peers (public_key, user_id, server_id, address, enabled, state, created_at)
       VALUES (?, ?, ?, ?, 1, 'active', ?)`,
    ).bind(created.publicKey, user.id, peer.server_id, created.address, now()),
    env.DB.prepare(`UPDATE peers SET state = 'pending_delete', enabled = 0 WHERE public_key = ?`).bind(
      publicKey,
    ),
  ]);

  // Best effort now; the sweep retries anything left behind.
  await removeFromAgent(env, server, publicKey).catch(() => {});

  return { publicKey: created.publicKey, address: created.address, conf: created.conf };
}

/** Frees a device slot. Without this a customer at the limit was stuck. */
export async function removePeer(env: Env, user: User, publicKey: string): Promise<PeerError | null> {
  const peer = await env.DB.prepare(`SELECT * FROM peers WHERE public_key = ? AND user_id = ?`)
    .bind(publicKey, user.id)
    .first<PeerRow>();
  if (!peer) return { error: 'not_found', status: 404 };

  await env.DB.prepare(`UPDATE peers SET state = 'pending_delete', enabled = 0 WHERE public_key = ?`)
    .bind(publicKey)
    .run();

  const server = await loadServer(env, peer.server_id);
  if (server) await removeFromAgent(env, server, publicKey).catch(() => {});
  return null;
}

/** Deletes on the agent and drops the row only once that succeeded. */
export async function removeFromAgent(env: Env, server: Server, publicKey: string) {
  await agent(env, server, 'DELETE', `/peers/${encodeURIComponent(publicKey)}`);
  await env.DB.prepare(`DELETE FROM peers WHERE public_key = ?`).bind(publicKey).run();
}

export const listPeers = (env: Env, userId: string) =>
  env.DB.prepare(
    `SELECT pr.public_key, pr.server_id, pr.address, pr.enabled, pr.created_at, s.name AS server_name
     FROM peers pr JOIN servers s ON s.id = pr.server_id
     WHERE pr.user_id = ? AND pr.state = 'active'
     ORDER BY pr.created_at DESC`,
  )
    .bind(userId)
    .all();
