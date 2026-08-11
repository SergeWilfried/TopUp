import { canonicalMsisdn, carrierAllowed, merchantUssdFor } from '@topup/core';
import { now, type Env } from '../env';

/**
 * Direct mobile-money collection, without a payment service provider.
 *
 * The customer dials their operator's merchant-payment code, types our merchant
 * number, the amount and their PIN. The money lands in our merchant wallet and
 * the operator texts us a confirmation. That text is the only evidence the
 * payment happened — there is no callback and no API to poll — so collection is
 * an *inbound* event here rather than something we ask about.
 *
 * Two consequences shape everything below:
 *
 *  1. **The amount is not ours to set.** These codes open a menu; the customer
 *     types the figure. So a payment can arrive for the wrong amount, and the
 *     match has to check rather than assume.
 *  2. **The payer is identified only by their number.** Matching is therefore
 *     on canonical MSISDN + amount + a time window, which is exactly why
 *     identity is stored in one canonical form.
 */

/** Merchant codes per market and wallet, from config. */
export function merchantCode(env: Env, country: string, carrier: string): string | null {
  if (!env.MERCHANT_CODES) return null;
  try {
    const table = JSON.parse(env.MERCHANT_CODES) as Record<string, Record<string, string>>;
    return table[country.toUpperCase()]?.[carrier] ?? null;
  } catch {
    // Malformed config must not silently disable payments in one market only.
    console.error('MERCHANT_CODES is not valid JSON');
    return null;
  }
}

/** Wallets in this market that can be paid by dialling, with their codes. */
export function dialableCarriers(env: Env, country: string, carriers: readonly string[]) {
  return carriers
    .map((carrier) => {
      const code = merchantCode(env, country, carrier);
      const ussd = code ? merchantUssdFor(country, carrier, code) : null;
      return ussd ? { carrier, ussd } : null;
    })
    .filter((x): x is { carrier: string; ussd: string } => x !== null);
}

export type DialInstructions = { carrier: string; ussd: string; amount: number; currency: string };

/**
 * Prepares a dial-to-pay payment. Nothing is called: the customer's handset is
 * the rail, so this only decides what to show them.
 */
export function prepareDial(
  env: Env,
  input: { country: string; carrier: string; amount: number; currency: string },
): { ok: true; dial: DialInstructions } | { ok: false; error: string } {
  if (!carrierAllowed(input.country, input.carrier)) {
    return { ok: false, error: 'carrier_unsupported' };
  }
  const code = merchantCode(env, input.country, input.carrier);
  if (!code) return { ok: false, error: 'merchant_not_configured' };

  const ussd = merchantUssdFor(input.country, input.carrier, code);
  if (!ussd) return { ok: false, error: 'dial_unavailable' };

  return { ok: true, dial: { carrier: input.carrier, ussd, amount: input.amount, currency: input.currency } };
}

export type Collection = {
  /** The paying wallet's number, as the operator reported it. */
  msisdn: string;
  amount: number;
  currency: string;
  /** The operator's own transaction id, from the confirmation message. */
  providerRef: string;
  country: string;
};

export type MatchResult =
  | { matched: true; paymentId: string; orderId: string }
  | { matched: false; reason: string };

/** How long after ordering a payment can still be attributed to it. */
const MATCH_WINDOW_MS = 60 * 60_000;

/**
 * Attributes an inbound payment to a waiting order.
 *
 * Matching is deliberately strict. An unmatched credit is left alone for a
 * human rather than applied to a plausible-looking order: crediting the wrong
 * customer is far worse than a payment sitting unallocated for an hour.
 */
export async function matchCollection(env: Env, c: Collection): Promise<MatchResult> {
  const payer = canonicalMsisdn(c.msisdn, c.country);
  if (!payer) return { matched: false, reason: 'unparseable_msisdn' };

  // Already seen. Operators resend, and a device replaying its inbox must not
  // pay for a second order.
  const seen = await env.DB.prepare(
    `SELECT id FROM payments WHERE provider = 'ussd' AND provider_ref = ?`,
  )
    .bind(c.providerRef)
    .first<{ id: string }>();
  if (seen) return { matched: false, reason: 'already_processed' };

  const row = await env.DB.prepare(
    `SELECT p.id AS paymentId, o.id AS orderId
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     JOIN customers cu ON cu.id = o.customer_id
     WHERE p.provider = 'ussd'
       AND p.status = 'pending'
       AND p.amount = ?
       AND p.currency = ?
       AND cu.msisdn = ?
       AND p.created_at > ?
     ORDER BY p.created_at ASC
     LIMIT 1`,
  )
    .bind(c.amount, c.currency, payer, now() - MATCH_WINDOW_MS)
    .first<{ paymentId: string; orderId: string }>();

  if (!row) return { matched: false, reason: 'no_matching_order' };

  // Claim it by writing the operator's reference, which also makes the replay
  // check above effective from here on.
  const claim = await env.DB.prepare(
    `UPDATE payments SET provider_ref = ? WHERE id = ? AND status = 'pending' AND provider_ref IS NULL`,
  )
    .bind(c.providerRef, row.paymentId)
    .run();
  if (claim.meta.changes === 0) return { matched: false, reason: 'already_claimed' };

  return { matched: true, paymentId: row.paymentId, orderId: row.orderId };
}
