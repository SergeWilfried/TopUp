import { now, type Env } from '../env';
import { fetchBundles, operatorCodesFor } from './lafricamobile';

/**
 * Keeps the data catalogue in step with what the distributor is actually
 * selling.
 *
 * Data bundles are not ours to invent. Each is bought by an opaque `bundleid`,
 * priced by the operator, and changes without notice — so the previous approach
 * of seeding our own "150 MB / 1 GB" rows produced a shop full of things that
 * could not be delivered, because none of them mapped to a real bundle.
 *
 * Airtime stays local: it is any amount, not a list, so the denominations are a
 * merchandising choice rather than a fact to fetch.
 */

/**
 * The price shown to the customer.
 *
 * Sold at the operator's own price, on the assumption that our margin is the
 * distributor discount at settlement — the same way airtime works, where the
 * customer pays face value. If LAM's `amount` turns out to be our cost rather
 * than the retail price, this is the one function to change.
 */
const retailPrice = (amount: number) => Math.round(amount);

/** "Beneficier de 500 Mo de connexion avec une validite de 2 jours" → "500 Mo". */
function titleFor(description: string, fallback: string): string {
  const size = description.match(/(\d+(?:[.,]\d+)?)\s*(Go|Mo|GB|MB)\b/i);
  return size ? `${size[1]} ${size[2]}` : fallback;
}

export type SyncResult = {
  synced: number;
  disabled: number;
  operators: Array<{ network: string; code: string; bundles: number; error?: string }>;
};

/**
 * Pulls every operator's bundles for a market into `products`.
 *
 * Writes into the existing table rather than a new one, so the catalogue,
 * checkout and delivery paths need no special case: a bundle is simply a data
 * product that happens to carry a `bundle_id`.
 *
 * Bundles that disappear are disabled rather than deleted — orders reference
 * their sku, and a missing row would break the history that shows what someone
 * bought.
 */
export async function syncDataBundles(env: Env, country: string, countryName: string): Promise<SyncResult> {
  const seenBundleIds = new Set<string>();
  const operators: SyncResult['operators'] = [];
  let synced = 0;

  for (const { network, code } of operatorCodesFor(country)) {
    const result = await fetchBundles(env, code);
    if (!result.ok) {
      operators.push({ network, code, bundles: 0, error: result.error });
      continue;
    }
    operators.push({ network, code, bundles: result.bundles.length });

    for (const b of result.bundles) {
      const id = `lam-${b.bundleid}`;
      seenBundleIds.add(String(b.bundleid));
      const price = retailPrice(Number(b.amount));
      await env.DB.prepare(
        `INSERT INTO products (id, type, name, name_key, country, network, terms, terms_key,
                               bonus, bonus_key, price, currency, days, enabled, sort_order,
                               created_at, bundle_id)
         VALUES (?, 'data', ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           terms = excluded.terms,
           price = excluded.price,
           currency = excluded.currency,
           network = excluded.network,
           country = excluded.country,
           sort_order = excluded.sort_order,
           enabled = 1,
           bundle_id = excluded.bundle_id`,
      )
        .bind(
          id,
          titleFor(b.data, `${b.amount} ${b.currency}`),
          countryName,
          network,
          // The operator's own wording is the honest description; it carries the
          // validity period, which the size alone does not.
          b.data,
          price,
          b.currency || 'XOF',
          price, // cheapest first
          now(),
          b.bundleid,
        )
        .run();
      synced++;
    }
  }

  // Anything previously synced for this market and no longer offered, plus the
  // hand-seeded rows the sync replaces.
  //
  // The old catalogue was invented locally: "3 GB +500 MB" with no bundle_id,
  // mapping to nothing the distributor sells. Those rows are not merely stale,
  // they are unbuyable — delivery refuses a data product with no bundle to
  // order — so leaving them enabled alongside the real ones puts products in
  // the shop that fail at checkout, and lets the home screen promote one.
  //
  // Guarded on having actually received bundles: a sync that failed to reach
  // the distributor must not empty the shop on its way out.
  const stale = synced
    ? await env.DB.prepare(
        `UPDATE products SET enabled = 0
         WHERE type = 'data' AND country = ? AND enabled = 1
           AND (bundle_id IS NULL OR bundle_id NOT IN (SELECT value FROM json_each(?)))`,
      )
        .bind(countryName, JSON.stringify([...seenBundleIds]))
        .run()
    : { meta: { changes: 0 } };

  console.log(`[bundles] ${country}: ${synced} synced, ${stale.meta.changes} disabled at ${now()}`);
  return { synced, disabled: stale.meta.changes ?? 0, operators };
}
