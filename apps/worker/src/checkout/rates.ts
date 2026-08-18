import { PAYMENT_ROUTES } from '@topup/core';
import { now, type Env } from '../env';

/**
 * The rate book, as an operator sees it.
 *
 * `fx_rates` was empty on the deployed worker and had no way to be filled: the
 * only writer was the fixture seeder, which refuses to run in production. The
 * pricing path handles that correctly — it returns `no_fx_rate` rather than
 * charging at a guess — but the visible effect was that every customer paying
 * in USD, CAD, GBP, NGN, KES or ZAR was quietly turned away at checkout, with
 * nothing anywhere saying why. The euro survived only because the CFA peg is
 * hard-coded as a fallback.
 *
 * So this lists the currencies the app can route to rather than the ones a row
 * happens to exist for. A missing rate is a row that says MISSING, not a row
 * that is absent — you cannot fix what the screen does not mention.
 */

const ROUTES = PAYMENT_ROUTES as Record<string, { provider: string; currency: string }>;

/** Non-pegged rates go stale; this is where we start saying so. */
const STALE_AFTER_DAYS = 7;

export type RateRow = {
  currency: string;
  /** Units of this currency per 1 XOF — the form the pricing code multiplies by. */
  perXof: number | null;
  /**
   * The same rate the way a person says it: "1 USD = 610 FCFA". Operators
   * think in this direction, and a screen that asks for 0.001639 is a screen
   * where a slipped decimal overcharges a customer tenfold.
   */
  xofPerUnit: number | null;
  pegged: boolean;
  updatedAt: number | null;
  ageDays: number | null;
  status: 'ok' | 'missing' | 'stale';
  /** Markets that cannot take payment while this rate is missing. */
  countries: string[];
  provider: string;
};

export async function listRates(env: Env): Promise<{ rows: RateRow[]; missing: number }> {
  const { results } = await env.DB.prepare(
    `SELECT currency, per_xof, pegged, updated_at FROM fx_rates`,
  ).all<{ currency: string; per_xof: number; pegged: number; updated_at: number }>();
  const stored = new Map(results.map((r) => [r.currency.toUpperCase(), r]));

  // Every currency the router can land on, XOF excluded: it is the book's own
  // unit and needs no rate.
  const wanted = new Map<string, { countries: string[]; provider: string }>();
  for (const [country, route] of Object.entries(ROUTES)) {
    if (route.currency === 'XOF') continue;
    const entry = wanted.get(route.currency) ?? { countries: [], provider: route.provider };
    entry.countries.push(country);
    wanted.set(route.currency, entry);
  }

  const t = now();
  const rows: RateRow[] = [...wanted.entries()]
    .map(([currency, meta]) => {
      const row = stored.get(currency);
      const ageDays = row ? Math.floor((t - row.updated_at) / 86_400_000) : null;
      const pegged = Boolean(row?.pegged);
      return {
        currency,
        perXof: row ? row.per_xof : null,
        xofPerUnit: row && row.per_xof > 0 ? Math.round((1 / row.per_xof) * 100) / 100 : null,
        pegged,
        updatedAt: row?.updated_at ?? null,
        ageDays,
        status: !row ? 'missing' : !pegged && (ageDays ?? 0) >= STALE_AFTER_DAYS ? 'stale' : 'ok',
        countries: meta.countries.sort(),
        provider: meta.provider,
      } satisfies RateRow;
    })
    .sort((a, b) => (a.status === b.status ? a.currency.localeCompare(b.currency) : a.status === 'missing' ? -1 : 1));

  return { rows, missing: rows.filter((r) => r.status === 'missing').length };
}

export type SetRateResult = { ok: true; row: RateRow } | { ok: false; error: string; status: number };

/**
 * Sets one rate, quoted the human way round.
 *
 * Deliberately not a bulk import and deliberately not seeded with indicative
 * numbers: a placeholder rate turns an honest 503 into a silently wrong price,
 * which is the worse failure. Refusing to sell costs one sale; selling at a
 * guessed rate loses money on every sale and nobody notices for a month.
 */
export async function setRate(env: Env, currencyRaw: string, xofPerUnit: unknown): Promise<SetRateResult> {
  const currency = String(currencyRaw ?? '').trim().toUpperCase();
  const known = new Set(Object.values(ROUTES).map((r) => r.currency));
  if (!currency || !known.has(currency) || currency === 'XOF') {
    return { ok: false, error: 'unknown_currency', status: 400 };
  }

  const value = Number(xofPerUnit);
  // A plausibility band, not a validation of the market. It catches the two
  // mistakes that actually happen — an inverted rate and a slipped decimal —
  // and lets every real quote through.
  if (!Number.isFinite(value) || value < 0.01 || value > 100_000) {
    return { ok: false, error: 'rate_out_of_range', status: 400 };
  }

  const existing = await env.DB.prepare(`SELECT pegged FROM fx_rates WHERE currency = ?`)
    .bind(currency)
    .first<{ pegged: number }>();
  // The CFA/euro peg is fixed by treaty. It is not an opinion an operator gets
  // to hold, and overwriting it would misprice the whole eurozone at once.
  if (existing?.pegged) return { ok: false, error: 'rate_is_pegged', status: 409 };

  await env.DB.prepare(
    `INSERT INTO fx_rates (currency, per_xof, pegged, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(currency) DO UPDATE SET per_xof = excluded.per_xof, updated_at = excluded.updated_at`,
  )
    .bind(currency, 1 / value, now())
    .run();

  const { rows } = await listRates(env);
  const row = rows.find((r) => r.currency === currency)!;
  return { ok: true, row };
}
