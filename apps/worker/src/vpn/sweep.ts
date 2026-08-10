import { agent, loadServer, type Server } from './agent';
import { now, type Env } from '../env';
import type { PeerRow } from './peers';

/**
 * A Worker invocation has a hard subrequest budget, and each peer costs one
 * agent call plus a D1 write. The sweep therefore takes a bounded slice per run
 * and lets the 15-minute schedule work through a backlog, rather than dying
 * half-way and leaving the tail permanently unprocessed.
 */
const BATCH = 40;
const CONCURRENCY = 8;

/** Runs `work` over `items` a few at a time; never rejects. */
async function pooled<T>(items: T[], work: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item).catch((e) => console.error(`sweep item failed: ${(e as Error).message}`));
    }
  });
  await Promise.all(runners);
}

const serverCache = (env: Env) => {
  const cache = new Map<string, Server | null>();
  return async (id: string) => {
    if (!cache.has(id)) cache.set(id, await loadServer(env, id));
    return cache.get(id) ?? null;
  };
};

export async function sweep(env: Env) {
  const getServer = serverCache(env);
  const t = now();

  // 1. Disable tunnels whose subscription has lapsed. The comparison is numeric:
  //    the old TEXT compare against datetime('now') left peers live for up to a
  //    day past expiry.
  const { results: expired } = await env.DB.prepare(
    `SELECT pr.* FROM peers pr JOIN users u ON u.id = pr.user_id
     WHERE pr.enabled = 1 AND pr.state = 'active'
       AND (u.sub_expires_at IS NULL OR u.sub_expires_at <= ?)
     LIMIT ?`,
  )
    .bind(t, BATCH)
    .all<PeerRow>();

  await pooled(expired, async (peer) => {
    const server = await getServer(peer.server_id);
    if (!server) return;
    await agent(env, server, 'PATCH', `/peers/${encodeURIComponent(peer.public_key)}`, { enabled: false });
    await env.DB.prepare(`UPDATE peers SET enabled = 0 WHERE public_key = ?`).bind(peer.public_key).run();
  });

  // 2. Finish deletions the request path could not complete. Without this,
  //    peers removed or regenerated during an agent outage stayed on the VPS.
  const { results: doomed } = await env.DB.prepare(
    `SELECT * FROM peers WHERE state = 'pending_delete' LIMIT ?`,
  )
    .bind(BATCH)
    .all<PeerRow>();

  await pooled(doomed, async (peer) => {
    const server = await getServer(peer.server_id);
    if (!server) {
      // The server is gone; nothing to reconcile against.
      await env.DB.prepare(`DELETE FROM peers WHERE public_key = ?`).bind(peer.public_key).run();
      return;
    }
    await agent(env, server, 'DELETE', `/peers/${encodeURIComponent(peer.public_key)}`);
    await env.DB.prepare(`DELETE FROM peers WHERE public_key = ?`).bind(peer.public_key).run();
  });

  // 3. Drop reservations abandoned by a crashed or cancelled provision, so the
  //    slot does not stay consumed forever.
  const stale = await env.DB.prepare(
    `DELETE FROM peers WHERE state = 'reserving' AND created_at < ?`,
  )
    .bind(t - 5 * 60_000)
    .run();

  // 4. Housekeeping.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(t),
    env.DB.prepare(`DELETE FROM otp_codes WHERE expires_at <= ?`).bind(t),
    env.DB.prepare(`DELETE FROM webhook_events WHERE received_at < ?`).bind(t - 30 * 86_400_000),
  ]);

  if (expired.length || doomed.length || stale.meta.changes) {
    console.log(
      `sweep: disabled ${expired.length}, deleted ${doomed.length}, released ${stale.meta.changes} reservation(s)`,
    );
  }
}
