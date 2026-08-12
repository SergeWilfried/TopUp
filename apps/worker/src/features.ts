import { now, type Env } from './env';

/**
 * Per-market feature switches.
 *
 * The point is to turn one thing off in one country without a deploy — a
 * distributor out of float, an operator changing a bundle format, a payment
 * rail down in a single market. Two rules make it trustworthy:
 *
 *  1. **The catalogue of features lives in code, not in the database.** A row
 *     for a feature nothing reads is a switch that appears to work and does
 *     nothing, which is worse than no switch. Unknown names are rejected at the
 *     boundary rather than stored.
 *  2. **Every feature declares its own default.** A market with no row, an
 *     empty table, or a database that cannot be read all resolve the same way,
 *     so a flag lookup never has an undefined answer.
 */

export const FEATURES = {
  airtime: { default: true, label: 'Airtime top-up' },
  data: { default: true, label: 'Data bundles' },
  esim: { default: true, label: 'eSIM' },
  vpn: { default: true, label: 'VPN' },
  /** Paying by dialling the operator's merchant code. */
  dial: { default: true, label: 'Dial-to-pay (USSD)' },
  /** Paying by approving a push prompt through the PSP. */
  momo: { default: true, label: 'Mobile money push' },
} as const;

export type FeatureName = keyof typeof FEATURES;

export type FeatureSet = Record<FeatureName, boolean>;

export const isFeature = (name: string): name is FeatureName => name in FEATURES;

/** The wildcard country: the default applied wherever no specific row exists. */
export const ANY_COUNTRY = '*';

const defaults = (): FeatureSet =>
  Object.fromEntries(
    Object.entries(FEATURES).map(([name, spec]) => [name, spec.default]),
  ) as FeatureSet;

type Row = { feature: string; country: string; enabled: number };

/**
 * Resolves every feature for one market.
 *
 * One query for both the country's rows and the wildcard defaults; the specific
 * country wins where both exist. Doing it in two queries would let a flag flip
 * between them and resolve against a state that never existed.
 *
 * A failed read falls back to the declared defaults rather than throwing. The
 * flags are consulted on the checkout path, and a switch table being briefly
 * unreadable should not take payments down with it — a deliberate choice, since
 * it does mean a kill switch is not honoured while D1 is unreachable. In
 * practice a checkout cannot complete then either, because writing the order
 * needs the same database.
 */
export async function featuresFor(env: Env, country: string): Promise<FeatureSet> {
  const resolved = defaults();
  const iso = (country ?? '').toUpperCase();

  try {
    const { results } = await env.DB.prepare(
      `SELECT feature, country, enabled FROM feature_flags WHERE country = ? OR country = ?`,
    )
      .bind(iso, ANY_COUNTRY)
      .all<Row>();

    // Wildcard first, so a country-specific row always overwrites it.
    for (const row of [...results].sort((a) => (a.country === ANY_COUNTRY ? -1 : 1))) {
      if (isFeature(row.feature)) resolved[row.feature] = row.enabled === 1;
    }
  } catch (e) {
    console.error(`feature flags unreadable, using defaults: ${(e as Error).message}`);
  }

  return resolved;
}

/** Whether one feature is on in one market. */
export async function featureEnabled(
  env: Env,
  country: string,
  feature: FeatureName,
): Promise<boolean> {
  return (await featuresFor(env, country))[feature];
}

/**
 * Sets or clears an override.
 *
 * `enabled: null` deletes the row, which is how a market goes back to following
 * the default rather than being pinned to whatever the default happened to be
 * on the day someone looked.
 */
export async function setFlag(
  env: Env,
  feature: FeatureName,
  country: string,
  enabled: boolean | null,
  note?: string | null,
): Promise<void> {
  const iso = country === ANY_COUNTRY ? ANY_COUNTRY : country.toUpperCase();

  if (enabled === null) {
    await env.DB.prepare(`DELETE FROM feature_flags WHERE feature = ? AND country = ?`)
      .bind(feature, iso)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO feature_flags (feature, country, enabled, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(feature, country) DO UPDATE SET
       enabled = excluded.enabled,
       note = excluded.note,
       updated_at = excluded.updated_at`,
  )
    .bind(feature, iso, enabled ? 1 : 0, note ?? null, now())
    .run();
}

/** Every override on record, for the console. */
export async function listFlags(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT feature, country, enabled, note, updated_at FROM feature_flags
     ORDER BY feature, country`,
  ).all<Row & { note: string | null; updated_at: number }>();

  return {
    features: Object.entries(FEATURES).map(([name, spec]) => ({
      name,
      label: spec.label,
      default: spec.default,
    })),
    overrides: results.map((r) => ({ ...r, enabled: r.enabled === 1 })),
  };
}
