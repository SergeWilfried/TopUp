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

/** The feed marks these by putting a word where a number belongs. */
export const isUnlimited = (data: string | number) => !Number.isFinite(Number(data));

/**
 * What "unlimited" actually means on these plans.
 *
 * The provider's fair-usage policy throttles to 5 Mbps after the first 500 MB
 * and to 512 kbps once a cap is reached — 25 GB on a 7-day plan, 40 GB on 15
 * days, 65 GB on 30. A tile that says only "Unlimited" is selling something
 * the customer will discover is not, which is a refund and a bad review. So
 * the limit rides along in the terms, on the tile, before the money moves.
 */
export function fairUsageNote(days: number): string {
  const cap = days >= 30 ? 65 : days >= 15 ? 40 : 25;
  return `5 Mbps after 500 MB, slower past ${cap} GB`;
}

export type EsimSyncResult = {
  synced: number;
  disabled: number;
  destinations: Array<{ code: string; name: string; plans: number }>;
  /**
   * Why a sync produced nothing, without needing the provider's feed in hand.
   * A run that fetches 900 plans and writes 0 is indistinguishable from one
   * that fetched nothing at all unless the misses are counted and named.
   */
  fetched?: number;
  skippedRegional?: number;
  skippedUnknownDestination?: number;
  /** ISO codes and country names the feed offered that we do not sell. */
  sampleUnmatched?: string[];
  error?: string;
};

export async function syncEsimPlans(env: Env): Promise<EsimSyncResult> {
  const { results: dests } = await env.DB.prepare(
    `SELECT code, name FROM destinations WHERE active = 1`,
  ).all<{ code: string; name: string }>();
  const byIso = new Map(dests.map((d) => [d.code.toUpperCase(), d]));

  // Also indexed by name, because matching on `countryIso2` alone is one
  // spelling away from matching nothing: the field is empty on some feed rows
  // and the country name is the only other thing a plan is sure to carry.
  const byName = new Map(dests.map((d) => [d.name.trim().toLowerCase(), d]));

  const res = await fetchPlans(env);
  if (!res.ok) {
    // Logged, not merely returned: the scheduled run discards the result, so
    // a silent error path is a sync that fails every fifteen minutes with
    // nothing to show for it.
    console.error(`[esim] plan fetch failed: ${res.error}`);
    return { synced: 0, disabled: 0, destinations: [], fetched: 0, error: res.error };
  }

  const margin = marginPct(env);
  const seen = new Set<string>();
  const perDest = new Map<string, number>();
  let synced = 0;
  let skippedRegional = 0;
  let skippedUnknown = 0;
  const unmatched = new Set<string>();
  const all = (res.data ?? []) as YesimPlan[];

  for (const p of all) {
    /**
     * Single-country plans only — but decided from the data, not a label.
     *
     * This used to test `plan_type !== 'country'`, a string taken from one
     * example in the documentation; any other spelling the feed happens to
     * use ('Country', 'local', blank) silently discarded the entire
     * catalogue. What actually makes a plan regional is that it covers more
     * than one country, and `countries_included` says so plainly.
     */
    const covers = String(p.countries_included ?? '')
      .split(/[,;/]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (covers.length > 1) { skippedRegional++; continue; }

    const dest =
      byIso.get(String(p.countryIso2 ?? '').trim().toUpperCase()) ??
      byName.get(covers[0]?.toLowerCase() ?? '') ??
      null;
    if (!dest) {
      skippedUnknown++;
      const label = `${String(p.countryIso2 ?? '?').trim()}:${covers[0] ?? p.name ?? '?'}`;
      if (unmatched.size < 12) unmatched.add(label);
      continue;
    }

    const priceEur = Number(p.price);
    const days = Number(p.days);
    if (!Number.isFinite(priceEur) || priceEur <= 0) continue;

    const id = `yesim-${p.id}`;
    seen.add(String(p.id));
    const price = xofPriceForEur(priceEur, margin);
    const validity = Number.isFinite(days) && days > 0 ? `Valid ${days} day${days === 1 ? '' : 's'}` : null;
    const unlimited = isUnlimited(p.data);
    // "Vodafone Albania · Valid 7 days" — the operator is what an eSIM is sold
    // on, and the validity is what tells two same-size plans apart. An
    // unlimited plan carries its throttle here too, because that is the part
    // the word "unlimited" hides.
    const terms = [p.operators, validity, unlimited && Number.isFinite(days) ? fairUsageNote(days) : null]
      .filter(Boolean)
      .join(' · ');
    // Three tiles all called "Unlimited" are indistinguishable on a shelf;
    // the validity is what separates them, so it belongs in the name.
    const name = unlimited && validity ? `Unlimited · ${days} days` : dataLabel(p.data);

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
        name,
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
  console.log(
    `[esim] fetched ${all.length}, synced ${synced}, disabled ${stale.meta.changes ?? 0}, ` +
      `skipped ${skippedRegional} regional / ${skippedUnknown} other destinations` +
      (synced === 0 && unmatched.size ? ` — feed offered: ${[...unmatched].join(', ')}` : ''),
  );
  return {
    synced,
    disabled: stale.meta.changes ?? 0,
    destinations,
    fetched: all.length,
    skippedRegional,
    skippedUnknownDestination: skippedUnknown,
    sampleUnmatched: [...unmatched],
  };
}
