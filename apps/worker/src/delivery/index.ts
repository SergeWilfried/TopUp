import { now, type Env } from '../env';
import {
  type DeliveryOutcome,
  type DeliveryProvider,
  type DeliveryRequest,
} from './types';

export * from './types';
import { yesim } from './yesim';
import { lafricamobile } from './lafricamobile';
import { mockEnabled, mockProvider } from './mock';
export { checkBalance } from './lafricamobile';

/**
 * Delivery orchestration.
 *
 * Every state change here is a conditional UPDATE guarded on the status we
 * expect to be leaving. That is the same rule the payment side uses: a
 * redelivered callback, a double-clicked retry and two overlapping cron sweeps
 * all lose the race harmlessly instead of delivering twice.
 */

const providers: DeliveryProvider[] = [];

/** Registered at startup. Order matters: the first match wins. */
export function registerProvider(provider: DeliveryProvider) {
  providers.push(provider);
}

/**
 * Builds the provider list for this request.
 *
 * Rebuilt per delivery rather than once per isolate because providers close
 * over `env`, which a Worker only receives with a request. Registration is
 * idempotent by name so repeated calls cannot stack duplicates.
 */
export function configureProviders(env: Env) {
  // First match wins, so the mock has to precede the real one.
  if (mockEnabled(env) && !providers.some((p) => p.name === 'mock')) {
    providers.unshift(mockProvider(env));
  }
  if (!providers.some((p) => p.name === 'lafricamobile')) {
    providers.push(lafricamobile(env));
  }
  if (!providers.some((p) => p.name === 'yesim')) {
    providers.push(yesim(env));
  }
}

export const providerFor = (req: DeliveryRequest): DeliveryProvider | null =>
  providers.find((p) => p.supports(req)) ?? null;

/**
 * Whether anything can deliver this, asked *before* taking payment.
 *
 * Without this the first sign that a corridor has no rail is a charged customer
 * sitting in `delivery_failed` waiting on a refund. A Kenyan number against an
 * Ivorian airtime product is a good example: perfectly payable, undeliverable.
 */
export function canDeliver(env: Env, req: DeliveryRequest): boolean {
  configureProviders(env);
  return providerFor(req) !== null;
}

export const providerByName = (name: string): DeliveryProvider | null =>
  providers.find((p) => p.name === name) ?? null;

type OrderRow = {
  id: string;
  product: string;
  sku: string | null;
  amount: number;
  status: string;
  recipient_msisdn: string | null;
  recipient_country: string | null;
  buyer_msisdn: string;
  buyer_country: string | null;
  network: string | null;
  bundle_id: string | null;
  esim_iccid: string | null;
};

/** Everything a provider needs, assembled from the order and its customer. */
async function loadRequest(env: Env, orderId: string): Promise<OrderRow | null> {
  return env.DB.prepare(
    `SELECT o.id, o.product, o.sku, o.amount, o.status,
            o.recipient_msisdn, o.recipient_country,
            c.msisdn AS buyer_msisdn, o.recipient_country AS buyer_country,
            COALESCE(o.network, p.network) AS network, p.bundle_id, o.esim_iccid
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN products p ON p.id = o.sku
     WHERE o.id = ?`,
  )
    .bind(orderId)
    .first<OrderRow>();
}

/**
 * Moves a paid order through delivery.
 *
 * Safe to call more than once: the claim below only succeeds for an order
 * sitting in `paid`, so a concurrent caller finds nothing to do rather than
 * dispatching a second top-up.
 */
export async function deliverOrder(env: Env, orderId: string): Promise<void> {
  configureProviders(env);
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'delivering', delivery_attempts = delivery_attempts + 1
     WHERE id = ? AND status = 'paid'`,
  )
    .bind(orderId)
    .run();
  if (claim.meta.changes === 0) return;

  const order = await loadRequest(env, orderId);
  if (!order) return;

  // The line being topped up is the recipient's when there is one, otherwise
  // the buyer's own. Getting this backwards credits the wrong person.
  const req: DeliveryRequest = {
    orderId: order.id,
    product: order.product,
    sku: order.sku,
    amount: order.amount,
    msisdn: order.recipient_msisdn || order.buyer_msisdn,
    // ISO-2 of the line being credited. Taken from the order, not the product:
    // the product's `country` is a display name for the market it belongs to,
    // which is neither a code nor necessarily where the recipient is.
    country: (order.recipient_country ?? '').toUpperCase(),
    network: order.network,
    bundleId: order.bundle_id,
    iccid: order.esim_iccid,
  };

  const provider = providerFor(req);
  if (!provider) {
    // No rail for this corridor. Not a delivery failure — nothing was tried —
    // but the customer has paid, so it must surface rather than sit silent.
    await settle(env, orderId, { status: 'failed', reason: 'no_provider' }, null);
    return;
  }

  let outcome: DeliveryOutcome;
  try {
    outcome = await provider.deliver(req);
  } catch (e) {
    // A thrown request is the ambiguous case: we do not know whether it landed.
    outcome = { status: 'unknown', providerRef: null, reason: (e as Error).message };
  }
  await settle(env, orderId, outcome, provider.name);
}

/** Writes a provider outcome onto the order, guarded on the expected state. */
async function settle(
  env: Env,
  orderId: string,
  outcome: DeliveryOutcome,
  providerName: string | null,
) {
  const ref = 'providerRef' in outcome ? outcome.providerRef : null;
  const reason = 'reason' in outcome ? outcome.reason : null;

  const next =
    outcome.status === 'delivered'
      ? 'delivered'
      : outcome.status === 'failed'
        ? 'delivery_failed'
        : outcome.status === 'unknown'
          ? 'delivery_unknown'
          : 'delivering'; // still pending at the provider

  await env.DB.prepare(
    `UPDATE orders
     SET status = ?, delivery_provider = ?, delivery_ref = ?, delivery_error = ?,
         delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
         delivery_checked_at = ?
     WHERE id = ? AND status IN ('delivering', 'delivery_unknown')`,
  )
    .bind(next, providerName, ref, reason, next, now(), now(), orderId)
    .run();
}

/**
 * Resolves orders whose outcome we never learned.
 *
 * Only ever asks the provider — it never retries the delivery itself. An
 * ambiguous top-up that is re-sent is a top-up the customer may receive twice
 * and we pay for twice, so the sweep can move an order forward only on a
 * definite answer. Anything still ambiguous stays put for a human.
 */
export async function reconcileDeliveries(env: Env, limit = 50): Promise<number> {
  configureProviders(env);
  const { results } = await env.DB.prepare(
    `SELECT id, delivery_provider, delivery_ref FROM orders
     WHERE status IN ('delivering', 'delivery_unknown') AND delivery_ref IS NOT NULL
     ORDER BY delivery_checked_at ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: string; delivery_provider: string | null; delivery_ref: string }>();

  let resolved = 0;
  for (const row of results) {
    const provider = row.delivery_provider ? providerByName(row.delivery_provider) : null;
    if (!provider?.check) continue;
    try {
      const outcome = await provider.check(row.delivery_ref);
      if (outcome.status === 'pending' || outcome.status === 'unknown') {
        // Touch the timestamp so one stuck order cannot monopolise the sweep.
        await env.DB.prepare(`UPDATE orders SET delivery_checked_at = ? WHERE id = ?`)
          .bind(now(), row.id)
          .run();
        continue;
      }
      await settle(env, row.id, outcome, provider.name);
      resolved++;
    } catch {
      await env.DB.prepare(`UPDATE orders SET delivery_checked_at = ? WHERE id = ?`)
        .bind(now(), row.id)
        .run();
    }
  }
  return resolved;
}
