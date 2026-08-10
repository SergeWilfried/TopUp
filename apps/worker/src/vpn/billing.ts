import { agent, loadServer } from './agent';
import { days, now, timingSafeEqual, type Env } from '../env';
import type { User } from './auth';
import type { PeerRow } from './peers';

const TOLERANCE_S = 300;
const DEFAULT_DAYS = 30;

/**
 * Verifies the Stripe signature.
 *
 * Stripe may send several `v1` values while a secret is being rotated, so every
 * one is checked. The comparison is constant time — the previous `===` leaked
 * how much of a forged signature was correct.
 */
export async function verifySignature(header: string | null, rawBody: string, secret: string) {
  if (!header || !secret) return false;

  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return signatures.some((sig) => timingSafeEqual(expected, sig));
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, any> };
};

/** How much time a payment buys. Falls back rather than silently granting 30d. */
/** Plan name as sold, for the console. Falls back to the duration. */
const planFor = (obj: Record<string, any>, grantDays: number): string =>
  obj?.metadata?.plan ??
  obj?.lines?.data?.[0]?.price?.nickname ??
  obj?.lines?.data?.[0]?.plan?.nickname ??
  `${grantDays} days`;

const daysFor = (obj: Record<string, any>): number => {
  const raw =
    obj?.metadata?.days ??
    obj?.lines?.data?.[0]?.price?.metadata?.days ??
    obj?.lines?.data?.[0]?.plan?.metadata?.days;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`no plan metadata on ${obj?.id ?? 'unknown'}; defaulting to ${DEFAULT_DAYS}d`);
    return DEFAULT_DAYS;
  }
  return Math.min(Math.round(n), 400);
};

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

export async function handleStripeEvent(env: Env, event: StripeEvent): Promise<WebhookOutcome> {
  if (!event.id || !event.type) return { status: 400, body: { error: 'malformed_event' } };

  // `checkout.session.completed` and `invoice.paid` both fire for the first
  // payment of a subscription. Only the invoice is authoritative; honouring
  // both granted two periods for one charge.
  const obj = event.data?.object ?? {};

  // A one-off catalogue purchase carries an order id. It is fulfilled by the
  // checkout module — granting subscription time here would hand out 30 days
  // of VPN for a 200 FCFA airtime top-up.
  const orderId: string | undefined = obj.metadata?.order_id;
  if (orderId) {
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)`,
    )
      .bind(event.id, event.type, now())
      .run();
    if (claim.meta.changes === 0) return { status: 200, body: { duplicate: event.id } };

    const { fulfil } = await import('../checkout/routes');
    const amount = typeof obj.amount_total === 'number' ? obj.amount_total : null;
    const result = await fulfil(env, obj.id ?? orderId, amount);
    return { status: 200, body: { received: true, order: orderId, ...result } };
  }

  const relevant =
    event.type === 'invoice.paid' ||
    (event.type === 'checkout.session.completed' && obj.mode === 'payment');
  if (!relevant) return { status: 200, body: { ignored: event.type } };

  // Claim the event id first. Stripe redelivers on any non-2xx and can repeat a
  // successful delivery; without this each redelivery added another period.
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)`,
  )
    .bind(event.id, event.type, now())
    .run();
  if (claim.meta.changes === 0) return { status: 200, body: { duplicate: event.id } };

  const email: string | undefined = obj.customer_email ?? obj.customer_details?.email;
  const customerId: string | undefined =
    typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;

  if (!email && !customerId) return { status: 200, body: { skipped: 'no_customer' } };

  // Prefer the Stripe id: emails change, and matching on them mis-assigns time.
  const user =
    (customerId
      ? await env.DB.prepare(`SELECT * FROM users WHERE stripe_customer_id = ?`)
          .bind(customerId)
          .first<User>()
      : null) ??
    (email ? await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<User>() : null);

  const t = now();
  const grantDays = daysFor(obj);
  const grant = days(grantDays);
  const plan = planFor(obj, grantDays);

  if (!user) {
    if (!email) return { status: 200, body: { skipped: 'no_email' } };
    await env.DB.prepare(
      `INSERT INTO users (id, email, stripe_customer_id, sub_expires_at, sub_started_at, plan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, users.stripe_customer_id),
         sub_expires_at = MAX(COALESCE(users.sub_expires_at, 0), ?) + ?,
         sub_started_at = COALESCE(users.sub_started_at, excluded.sub_started_at),
         plan = excluded.plan`,
    )
      .bind(crypto.randomUUID(), email, customerId ?? null, t + grant, t, plan, t, t, grant)
      .run();
    return { status: 200, body: { received: true } };
  }

  // Extend from whichever is later: a lapsed customer gets no free backdating.
  const base = Math.max(user.sub_expires_at ?? 0, t);
  await env.DB.prepare(
    `UPDATE users
     SET sub_expires_at = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         -- First grant only: renewals must not reset when they joined.
         sub_started_at = COALESCE(sub_started_at, ?),
         plan = ?
     WHERE id = ?`,
  )
    .bind(base + grant, customerId ?? null, t, plan, user.id)
    .run();

  await reenablePeers(env, user.id);
  return { status: 200, body: { received: true } };
}

/**
 * Brings previously-disabled tunnels back.
 *
 * Failures are logged, not thrown: the payment has already been recorded, and
 * returning non-2xx would make Stripe redeliver. Anything still disabled is
 * picked up by the reconciliation sweep.
 */
async function reenablePeers(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM peers WHERE user_id = ? AND enabled = 0 AND state = 'active'`,
  )
    .bind(userId)
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
      console.error(`re-enable failed for ${peer.public_key}: ${(e as Error).message}`);
    }
  }
}
