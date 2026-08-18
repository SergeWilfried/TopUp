import { EUR_PEG } from '@topup/core';
import { now, type Env } from '../env';
import { fetchPlans, type YesimPlan } from './yesim';

/**
 * Keeps the eSIM catalogue in step with what Yesim actually sells.
 *
 * Like data bundles, eSIM plans are not ours to invent: each is a provider
 * plan id on a named operator, priced by the provider in EUR, and it changes
 * without notice. The seeded "5 GB · Orange" rows mapped to nothing that could
 * be provisioned; these rows carry the real plan id in `bundle_id`, which is
 * what delivery sends to /add_plan_iccid.
 *
 * Only destinations we have chosen to sell into are synced — the `destinations`
 * table stays the curated list of corridors — so a customer sees a shop, not
 * Yesim's whole atlas.
 */

/**
 * The XOF price of a plan quoted in EUR.
 *
 * XOF is pegged to the euro, so the conversion is a fact, not a feed. The
 * margin is ours and is the only number here that is a business decision —
 * held in an env var so it can be changed without a deploy. Rounded up to a
 * clean 50 F: a price like 1 837 F reads as a mistake.
 */
export function xofPriceForEur(priceEur: number, marginPct: number): number {
  const raw = priceEur * EUR_PEG * (1 + marginPct / 100);
  return Math.ceil(raw / 50) * 50;
}

const marginPct = (env: Env) => {
  const n = Number(env.ESIM_MARGIN_PCT);
  return Number.isFinite(n) && n >= 0 ? n : 25;
};

/** "0.49" → "490 MB", "5" → "5 GB", "20" → "20 GB". */
export function dataLabel(gb: string | number): string {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return String(gb);
  if (n < 1) return `${Math.round(n * 1000)} MB`;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} GB`;
}

export type EsimSyncResult = {
  synced: number;
  disabled: number;
  destinations: Array<{ code: string; name: string; plans: number }>;
  error?: string;
};

export async function syncEsimPlans(env: Env): Promise<EsimSyncResult> {
  const { results: dests } = await env.DB.prepare(
    `SELECT code, name FROM destinations WHERE active = 1`,
  ).all<{ code: string; name: string }>();
  const byIso = new Map(dests.map((d) => [d.code.toUpperCase(), d]));

  const res = await fetchPlans(env);
  if (!res.ok) return { synced: 0, disabled: 0, destinations: [], error: res.error };

  const margin = marginPct(env);
  const seen = new Set<string>();
  const perDest = new Map<string, number>();
  let synced = 0;

  for (const p of res.data as YesimPlan[]) {
    // Single-country plans only: a regional plan names no operator we can put
    // on a destination tile, and the shop is organised by country.
    if (p.plan_type && p.plan_type !== 'country') continue;
    const dest = byIso.get(String(p.countryIso2 ?? '').toUpperCase());
    if (!dest) continue;

    const priceEur = Number(p.price);
    const days = Number(p.days);
    if (!Number.isFinite(priceEur) || priceEur <= 0) continue;

    const id = `yesim-${p.id}`;
    seen.add(String(p.id));
    const price = xofPriceForEur(priceEur, margin);
    // "Vodafone Albania · Valid 7 days" — the operator is what an eSIM is sold
    // on, and the validity is what tells two same-size plans apart.
    const terms = [p.operators, Number.isFinite(days) && days > 0 ? `Valid ${days} day${days === 1 ? '' : 's'}` : null]
      .filter(Boolean)
      .join(' · ');

    await env.DB.prepare(
      `INSERT INTO products (id, type, name, name_key, country, network, terms, terms_key, terms_params,
                             bonus, bonus_key, price, currency, days, enabled, sort_order, created_at, bundle_id)
       VALUES (?, 'esim', ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'XOF', ?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         country = excluded.country,
         network = excluded.network,
         terms = excluded.terms,
         price = excluded.price,
         days = excluded.days,
         sort_order = excluded.sort_order,
         enabled = 1,
         bundle_id = excluded.bundle_id`,
    )
      .bind(
        id,
        dataLabel(p.data),
        dest.name, // products.country is the display name the app queries by
        p.operators || null,
        terms,
        price,
        Number.isFinite(days) ? days : null,
        price, // cheapest first
        now(),
        String(p.id),
      )
      .run();
    synced++;
    perDest.set(dest.code, (perDest.get(dest.code) ?? 0) + 1);
  }

  // Retire eSIM rows the provider no longer offers — and the hand-seeded ones
  // with no plan id, which were never provisionable. Guarded on a non-empty
  // sync so a failed fetch cannot empty the shop.
  const stale = synced
    ? await env.DB.prepare(
        `UPDATE products SET enabled = 0
         WHERE type = 'esim' AND enabled = 1
           AND (bundle_id IS NULL OR bundle_id NOT IN (SELECT value FROM json_each(?)))`,
      )
        .bind(JSON.stringify([...seen]))
        .run()
    : { meta: { changes: 0 } };

  const destinations = dests.map((d) => ({ code: d.code, name: d.name, plans: perDest.get(d.code) ?? 0 }));
  console.log(`[esim] ${synced} plans synced, ${stale.meta.changes} disabled at ${now()}`);
  return { synced, disabled: stale.meta.changes ?? 0, destinations };
}
