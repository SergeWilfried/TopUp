import {
  CURRENCY_DECIMALS as DECIMALS_RAW,
  EUR_PEG,
  PROVIDER_LABELS,
  convertFromXof,
  routeForCountry,
  toMinorUnits,
} from '@topup/core';

// The core maps are plain objects; index them by an arbitrary currency code.
const CURRENCY_DECIMALS = DECIMALS_RAW as Record<string, number>;
const LABELS = PROVIDER_LABELS as Record<string, string>;
import { now, type Env } from '../env';

/**
 * Turns a XOF catalogue price into something a rail will actually accept.
 *
 * PawaPay settles XOF directly, and Paystack can too on an Ivorian
 * integration. Stripe cannot settle XOF at all, so those customers are billed
 * in their own currency — converted before the charge, never on the client.
 *
 * Each provider has its own amount convention, so `quote.amount` is the major
 * unit and the provider module converts. `minorAmount` here is the ISO figure
 * Stripe expects; Paystack multiplies by 100 regardless of ISO.
 */

export type Quote = {
  provider: 'pawapay' | 'paystack' | 'stripe';
  label: string;
  country: string;
  currency: string;
  /** Human amount in the billing currency, e.g. 9.15 EUR. Includes the fee. */
  amount: number;
  /** What the provider's API wants: cents, kobo, or whole francs. */
  minorAmount: number;
  /** Always the catalogue figure, for reconciliation. Excludes the fee. */
  amountXof: number;
  /** Face value in the billing currency — `amount` less `fee`. */
  subtotal: number;
  /** Service fee in the billing currency, already included in `amount`. */
  fee: number;
  /** Service fee in XOF, already included in `amount`. Zero where none applies. */
  feeXof: number;
  /** The rate that produced `feeXof`, so the app can label it without hardcoding. */
  feePct: number;
  /** Face value plus fee, in XOF — what the customer is actually charged. */
  chargedXof: number;
  rate: number;
};

export type QuoteError = { error: string; status: number };
export const isQuoteError = (v: unknown): v is QuoteError =>
  typeof v === 'object' && v !== null && 'error' in v;

/** Rates are cached per request; a checkout may quote several products. */
export async function loadRates(env: Env): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare(`SELECT currency, per_xof FROM fx_rates`).all<{
    currency: string;
    per_xof: number;
  }>();
  const rates: Record<string, number> = { XOF: 1 };
  for (const r of results) rates[r.currency] = r.per_xof;
  // The peg is a fact, not a quote — fall back to it if the row is missing.
  if (!rates.EUR) rates.EUR = 1 / EUR_PEG;
  return rates;
}

/**
 * Products that carry a service fee.
 *
 * Airtime and data only. A VPN or eSIM is our own product sold at our own
 * price, so a separate "fee" line on top would be an invented charge; a top-up
 * has a face value the customer recognises, and the fee is what we are paid for
 * saving them the trip.
 */
const FEE_BEARING = new Set(['airtime', 'data']);

/** Percent, from config so it can move without a deploy. Defaults to 2. */
export const feePercent = (env: Env) => {
  const raw = Number(env.SERVICE_FEE_PCT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 20 ? raw : 2;
};

/**
 * The fee on a top-up, in whole francs.
 *
 * Charged on the face value, never on the converted amount: a Burkinabè and a
 * French customer buying the same 1 000 F top-up should pay the same fee in
 * real terms. Rounded up so it is never zero on a small bundle — 2% of 155 F
 * rounds to 3, not to nothing.
 */
export function serviceFeeXof(env: Env, productType: string, faceXof: number): { xof: number; pct: number } {
  if (!FEE_BEARING.has(productType)) return { xof: 0, pct: 0 };
  const pct = feePercent(env);
  return { xof: Math.ceil((faceXof * pct) / 100), pct };
}

export function quoteFor(
  amountXof: number,
  country: string,
  rates: Record<string, number>,
  feeXof = 0,
  feePct = 0,
): Quote | QuoteError {
  const route = routeForCountry(country);
  if (!route) return { error: 'country_unsupported', status: 422 };

  // The customer pays face value plus fee; the recipient receives face value.
  const chargedXof = amountXof + feeXof;
  const amount = convertFromXof(chargedXof, route.currency, rates);
  // Refusing is the only safe move: charging at a guessed rate loses money on
  // every sale, and charging XOF on a rail that rejects it fails anyway.
  if (amount === null) return { error: 'no_fx_rate', status: 503 };

  // Derived by subtraction rather than converted on its own, so the breakdown
  // always sums to the total charged. Converting each line separately leaves the
  // two rounding remainders showing as a summary that does not add up — a penny
  // of arithmetic the customer has every right to question.
  const subtotal = convertFromXof(amountXof, route.currency, rates) ?? amount;
  const fee = Math.round((amount - subtotal) * 100) / 100;

  return {
    provider: route.provider,
    label: LABELS[route.provider],
    country: country.toUpperCase(),
    currency: route.currency,
    amount,
    minorAmount: toMinorUnits(amount, route.currency),
    amountXof,
    subtotal,
    fee,
    feeXof,
    feePct,
    chargedXof,
    rate: rates[route.currency] ?? 1,
  };
}

/** Seeds the rate table. Floating rates are placeholders to be replaced. */
export async function seedRates(env: Env) {
  const t = now();
  const rows: [string, number, number][] = [
    // Fixed by treaty — 655.957 XOF to the euro.
    ['EUR', 1 / EUR_PEG, 1],
    // Indicative only. Wire these to a rate feed before taking real money.
    ['USD', 1 / 610, 0],
    ['CAD', 1 / 445, 0],
    ['GBP', 1 / 775, 0],
    ['NGN', 2.6, 0],
    ['KES', 1 / 4.7, 0],
    ['ZAR', 1 / 33, 0],
  ];
  await env.DB.batch(
    rows.map(([currency, rate, pegged]) =>
      env.DB.prepare(
        `INSERT INTO fx_rates (currency, per_xof, pegged, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(currency) DO UPDATE SET per_xof = excluded.per_xof, updated_at = excluded.updated_at`,
      ).bind(currency, rate, pegged, t),
    ),
  );
  return { rates: rows.length };
}

export const formatQuote = (q: Quote) =>
  `${q.amount.toFixed(CURRENCY_DECIMALS[q.currency] ?? 2)} ${q.currency}`;
