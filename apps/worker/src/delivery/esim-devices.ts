import { now, type Env } from '../env';
import { supportedDevices } from './yesim';

/**
 * Handset compatibility for eSIM.
 *
 * An eSIM is the only thing we sell that the customer's own hardware can
 * refuse. Airtime reaches any phone; a QR code reaches a phone with an eUICC
 * in it and nothing else. Selling one to a handset that cannot hold it is a
 * refund, a support conversation, and a customer who does not come back.
 *
 * Yesim publishes the list it installs onto, so this file keeps a local copy
 * and matches against it. The matching is deliberately asymmetric: a hit is
 * evidence, a miss is not. See `lookup`.
 */

/**
 * A model string reduced to what two sources are likely to agree on.
 *
 * The feed writes models the way marketing does — "iPhone 15 Pro (not Dual
 * SIM*)", "Galaxy Z Flip and Z Flip 5G (US versions … are not compatible)" —
 * so the parenthetical caveats come off first; they are prose, not identity.
 * Everything else collapses to lowercase alphanumerics, with `+` kept because
 * it is the only punctuation that distinguishes two real products
 * (Galaxy S25 from S25+).
 */
export function normalizeModel(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Google Pixel" and "google" are the same maker; the feed and Android differ. */
const normalizeBrand = (raw: unknown) =>
  normalizeModel(raw).replace(/^google pixel$/, 'google').replace(/^other$/, '');

export type DeviceSyncResult = { models: number; brands: number; types: number; retired: number; error?: string };

/**
 * Refreshes the local copy of the provider's device list.
 *
 * Runs on the same daily window as the plan sync: the list changes when a
 * handset launches, which is weekly at most, and the payload is 16 KB.
 */
export async function syncEsimDevices(env: Env): Promise<DeviceSyncResult> {
  const res = await supportedDevices(env);
  if (!res.ok) {
    console.error(`[esim] device list fetch failed: ${res.error}`);
    return { models: 0, brands: 0, types: 0, retired: 0, error: res.error };
  }

  const stamp = now();
  const brands = new Set<string>();
  const types = new Set<string>();
  let models = 0;

  for (const group of res.data ?? []) {
    types.add(group.type);
    for (const brand of group.brands ?? []) {
      brands.add(brand.brand);
      for (const { model } of brand.models ?? []) {
        // Indexed under both spellings, because the feed is inconsistent about
        // whether the maker is part of the model: "Galaxy A36" sits under
        // Samsung, but "Motorola Moto G85" and "Xiaomi 14" carry theirs. A
        // handset reports the two halves separately, so both forms must hit.
        const bare = normalizeModel(model);
        if (!bare) continue;
        const brandNorm = normalizeBrand(brand.brand);
        const withBrand = brandNorm && !bare.startsWith(brandNorm) ? `${brandNorm} ${bare}` : bare;
        for (const key of new Set([bare, withBrand])) {
          await env.DB.prepare(
            `INSERT INTO esim_devices (model_norm, type, brand, model, synced_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(model_norm) DO UPDATE SET
               type = excluded.type, brand = excluded.brand,
               model = excluded.model, synced_at = excluded.synced_at`,
          )
            .bind(key, group.type, brand.brand, model, stamp)
            .run();
        }
        models++;
      }
    }
  }

  // Rows this run did not touch are models the provider dropped. Guarded on a
  // non-empty sync so a bad fetch cannot empty the table and turn every
  // handset into an unknown one.
  const retired = models
    ? await env.DB.prepare(`DELETE FROM esim_devices WHERE synced_at < ?`).bind(stamp).run()
    : { meta: { changes: 0 } };

  console.log(`[esim] devices: ${models} models, ${brands.size} brands, ${types.size} types`);
  return { models, brands: brands.size, types: types.size, retired: retired.meta.changes ?? 0 };
}

/**
 * `supported` when the provider lists this handset; `unknown` otherwise.
 *
 * There is no `unsupported`, and that is the whole design. The list is the
 * provider's own, not a register of every eUICC ever shipped, so absence
 * proves nothing — and the brands absent from it are precisely the ones this
 * market buys. Telling a Tecno owner their phone will not work, on that
 * evidence, would be a guess dressed as a fact, and would refuse sales we
 * could have made.
 *
 * The honest fallback belongs to the customer: dialling *#06# shows an EID on
 * a handset with an eSIM and nothing on one without. The app says so.
 */
export async function lookup(
  env: Env,
  brand: unknown,
  model: unknown,
): Promise<{ verdict: 'supported' | 'unknown'; matched?: string }> {
  const bare = normalizeModel(model);
  if (!bare) return { verdict: 'unknown' };
  const brandNorm = normalizeBrand(brand);

  const candidates = new Set([bare]);
  if (brandNorm) {
    candidates.add(`${brandNorm} ${bare}`);
    // And without it, for a handset that reports "Moto G85" under brand
    // "motorola" against a feed row already reading "Motorola Moto G85".
    if (bare.startsWith(`${brandNorm} `)) candidates.add(bare.slice(brandNorm.length + 1));
  }

  const keys = [...candidates];
  const exact = await env.DB.prepare(
    `SELECT model FROM esim_devices WHERE model_norm IN (${keys.map(() => '?').join(',')}) LIMIT 1`,
  )
    .bind(...keys)
    .first<{ model: string }>();
  if (exact) return { verdict: 'supported', matched: exact.model };

  /**
   * One containment pass, for the rows that name several products at once
   * ("Galaxy Z Flip and Z Flip 5G", "iPad Pro 11 (2021 and 2022)"). Floored at
   * eight characters: "s25" is a substring of half the catalogue, and a wrong
   * `supported` is worse than an honest `unknown`.
   */
  for (const key of keys) {
    if (key.length < 8) continue;
    const near = await env.DB.prepare(
      `SELECT model FROM esim_devices WHERE model_norm LIKE ? LIMIT 1`,
    )
      .bind(`%${key}%`)
      .first<{ model: string }>();
    if (near) return { verdict: 'supported', matched: near.model };
  }

  return { verdict: 'unknown' };
}

/**
 * What the installed base actually holds, and how much of it can take an eSIM.
 *
 * The provider's list answers "is this model compatible". It cannot answer the
 * question that decides whether an eSIM corridor is worth building — what
 * share of *our* customers hold a compatible handset — and nothing else we
 * store can either. This is that number.
 */
export async function deviceBreakdown(env: Env) {
  const { results: brands } = await env.DB.prepare(
    // Lower-cased to group, because the platforms disagree about case for the
    // same maker — Android reports "samsung", iOS "Apple" — and two rows for
    // one brand is a census that does not add up.
    `SELECT LOWER(COALESCE(NULLIF(TRIM(brand), ''), 'unknown')) AS brand,
            COUNT(*) AS installs,
            SUM(CASE WHEN esim_capable = 1 THEN 1 ELSE 0 END) AS capable
     FROM device_seen GROUP BY 1 ORDER BY installs DESC`,
  ).all<{ brand: string; installs: number; capable: number }>();

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS installs, SUM(CASE WHEN esim_capable = 1 THEN 1 ELSE 0 END) AS capable
     FROM device_seen`,
  ).first<{ installs: number; capable: number }>();

  // The models we see most and cannot place. This is the work queue: each one
  // is either a handset the provider does not list or a spelling we failed to
  // match, and only reading them tells you which.
  const { results: unmatched } = await env.DB.prepare(
    `SELECT brand, model, COUNT(*) AS installs FROM device_seen
     WHERE esim_capable IS NOT 1 AND model IS NOT NULL
     GROUP BY brand, model ORDER BY installs DESC LIMIT 25`,
  ).all<{ brand: string; model: string; installs: number }>();

  const installs = totals?.installs ?? 0;
  return {
    installs,
    capable: totals?.capable ?? 0,
    capablePct: installs ? Math.round(((totals?.capable ?? 0) / installs) * 1000) / 10 : null,
    brands,
    unmatched,
  };
}
