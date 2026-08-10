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
  /** Human amount in the billing currency, e.g. 9.15 EUR. */
  amount: number;
  /** What the provider's API wants: cents, kobo, or whole francs. */
  minorAmount: number;
  /** Always the catalogue figure, for reconciliation. */
  amountXof: number;
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

export function quoteFor(
  amountXof: number,
  country: string,
  rates: Record<string, number>,
): Quote | QuoteError {
  const route = routeForCountry(country);
  if (!route) return { error: 'country_unsupported', status: 422 };

  const amount = convertFromXof(amountXof, route.currency, rates);
  // Refusing is the only safe move: charging at a guessed rate loses money on
  // every sale, and charging XOF on a rail that rejects it fails anyway.
  if (amount === null) return { error: 'no_fx_rate', status: 503 };

  return {
    provider: route.provider,
    label: LABELS[route.provider],
    country: country.toUpperCase(),
    currency: route.currency,
    amount,
    minorAmount: toMinorUnits(amount, route.currency),
    amountXof,
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
