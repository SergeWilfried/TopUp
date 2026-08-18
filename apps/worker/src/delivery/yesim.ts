import { now, type Env } from '../env';
import type { DeliveryOutcome, DeliveryProvider, DeliveryRequest } from './types';

/**
 * Yesim Partner API — the eSIM rail.
 *
 * Yesim sells data plans on named operators worldwide and provisions them onto
 * eSIM profiles it issues. Their flow, which this file follows exactly:
 *
 *   /plans           → the catalogue (id, data, days, price in EUR, operator)
 *   /new_esim        → issue a profile: ICCID + LPA activation code (the QR)
 *   /add_plan_iccid  → put a plan on that ICCID (activation, or a top-up)
 *   /sim_info        → the profile's state: QR, install links, data left
 *
 * The token travels as a *query parameter*, so no built URL may ever be logged
 * — the same rule as LAfricaMobile.
 *
 * Docs: https://documenter.getpostman.com/view/19324374/2sA3kbgy28
 */

const DEFAULT_BASE = 'https://partners-api.yesim.biz';
const base = (env: Env) => (env.YESIM_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
export const yesimConfigured = (env: Env) => Boolean(env.YESIM_TOKEN);

export type YesimPlan = {
  id: string;
  name: string;
  days: string;
  price: string; // EUR, as a string
  data: string; // GB, as a string
  countries_included: string;
  countryIso2: string;
  mcc: string;
  iso3: string;
  operators: string;
  image: string;
  apn: string;
  plan_type: string; // 'country' | 'region' | ...
};

export type SimInfo = {
  id: string;
  iccid: string;
  user_id: string | null;
  created_at: string;
  active_plan_id: string | null;
  plan_activated_at: string | null;
  plan_expired_at: string | null;
  qrcode: string; // LPA:1$smdp.io$…
  status_qr: string; // Released | Enabled | Deleted | …
  imsi: string | null;
  msisdn: string | null;
  is_deleted: string;
  data_left_mb?: number;
  data_package_mb?: number;
  data_used_mb?: number;
  img?: string; // data: PNG of the QR — we render our own
  networkinfo?: { time: string; lastMcc: number; lastMnc: number; lastRat: string; model?: string };
  ios_tap_link?: string;
  esim_passport?: string;
  is_voucher?: boolean;
  voucher_status?: string;
  voucher_code?: string;
  status?: string | null;
  error?: string | null;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/**
 * One call. Query params always include the token; POSTs carry an optional
 * JSON body. Errors are values — the delivery port needs to tell "the API said
 * no" from "the request never landed", and only the latter is ambiguous.
 */
async function call<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | undefined> = {},
  body?: unknown,
  timeoutMs = 20_000,
): Promise<Result<T>> {
  if (!yesimConfigured(env)) return { ok: false, error: 'not_configured' };
  const url = new URL(`${base(env)}${path}`);
  url.searchParams.set('token', env.YESIM_TOKEN!);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Do not include the URL: it carries the token.
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, error: `bad_json_${res.status}`, status: res.status };
  }
  if (!res.ok) {
    const msg = (data as { error?: string; description?: string; message?: string } | null);
    return { ok: false, error: msg?.error ?? msg?.description ?? msg?.message ?? `http_${res.status}`, status: res.status };
  }
  return { ok: true, data: data as T };
}

// ── endpoints ───────────────────────────────────────────────────────────────

/**
 * GET /plans — the whole sellable catalogue.
 *
 * Around 1 500 plans and 700 KB, and the provider serves it slowly and very
 * unevenly: measured at 2.4 s, 9.1 s and 25.6 s on three consecutive calls.
 * The 20-second default aborted the third of those, and an abort here is
 * indistinguishable from an outage — which is how this ran for weeks writing
 * nothing. Ninety seconds, and one retry, because the cost of waiting is a
 * slow cron and the cost of giving up is an empty shop.
 */
export async function fetchPlans(env: Env): Promise<Result<YesimPlan[]>> {
  const first = await call<YesimPlan[]>(env, 'GET', '/plans', {}, undefined, 90_000);
  if (first.ok || first.status !== undefined) return first;
  // No status means the request never completed — a timeout or a dropped
  // connection. That is the case worth one more try; a 4xx is not.
  console.warn(`[yesim] /plans did not complete (${first.error}) — retrying once`);
  return call<YesimPlan[]>(env, 'GET', '/plans', {}, undefined, 90_000);
}

/** GET /new_esim — issues one profile; `userId` optionally assigns it. */
export const newEsim = (env: Env, userId?: string) =>
  call<SimInfo>(env, 'GET', '/new_esim', { user_id: userId });

/** POST /add_plan_iccid — activates a plan on a profile, or tops one up. */
export const addPlanToIccid = (env: Env, iccid: string, planId: string) =>
  call<{ status: string; description?: string }>(env, 'POST', '/add_plan_iccid', { iccid, plan_id: planId });

/** GET /sim_info — one profile's state, install links included. */
export const simInfo = (env: Env, iccid: string) => call<SimInfo>(env, 'GET', '/sim_info', { iccid });

/** POST /bulk_sim_info — up to a page of profiles at once. */
export const bulkSimInfo = (env: Env, iccids: string[]) =>
  call<{ data: SimInfo[]; pagination?: unknown; summary?: { found: number; failed: number } }>(
    env,
    'POST',
    '/bulk_sim_info',
    {},
    { iccids },
  );

/** POST /new_user — a Yesim-side account an eSIM can be assigned to. */
export const newUser = (env: Env, email: string) =>
  call<{ user_id: string; email: string }>(env, 'POST', '/new_user', { email });

export type YesimDeviceGroup = {
  /** PHONE | TABLET | LAPTOP | SMARTWATCH | CAR | WI-FI ROUTERS */
  type: string;
  brands: Array<{ brand: string; models: Array<{ model: string }> }>;
};

/**
 * GET /supported_devices — every handset the provider will install onto.
 *
 * A flat catalogue, ~456 models, no lookup parameter: you fetch all of it and
 * match locally. It answers "can this model hold an eSIM", which is worth
 * asking *before* taking money for a QR code the customer cannot install.
 *
 * What it is not is exhaustive. It is the provider's curated list, and a model
 * missing from it is unproven rather than disproven — Transsion (Tecno,
 * Infinix, itel), which is most of what sells in this market, appears zero
 * times. So a miss here is reported as unknown, never as unsupported.
 */
export const supportedDevices = (env: Env) =>
  call<YesimDeviceGroup[]>(env, 'GET', '/supported_devices', {}, undefined, 30_000);

/** GET /balance — what is left on the partner account. */
export const balance = (env: Env) => call<{ balance: string | number; currency: string }>(env, 'GET', '/balance');

/** GET /allowed_operators — the network list, optionally filtered. */
export const allowedOperators = (env: Env, filter: { country?: string; tadig?: string; location_zone?: string } = {}) =>
  call<Array<{ id: string; country: string; operator: string; tadig: string; location_zone: string }>>(
    env,
    'GET',
    '/allowed_operators',
    filter,
  );

// ── persistence ─────────────────────────────────────────────────────────────

/** Copies what `sim_info` knows onto our row. Best effort — never throws. */
export async function storeSimInfo(env: Env, info: SimInfo, extra: { orderId?: string; customerId?: string; planId?: string; label?: string; country?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO esims (iccid, customer_id, order_id, provider, provider_esim_id, plan_id, label, country,
                        qrcode, ios_tap_link, passport_url, status_qr, plan_activated_at, plan_expired_at,
                        data_package_mb, data_left_mb, data_used_mb, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, 'yesim', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(iccid) DO UPDATE SET
       customer_id = COALESCE(excluded.customer_id, esims.customer_id),
       order_id = COALESCE(esims.order_id, excluded.order_id),
       plan_id = COALESCE(excluded.plan_id, esims.plan_id),
       label = COALESCE(excluded.label, esims.label),
       country = COALESCE(excluded.country, esims.country),
       qrcode = COALESCE(excluded.qrcode, esims.qrcode),
       ios_tap_link = COALESCE(excluded.ios_tap_link, esims.ios_tap_link),
       passport_url = COALESCE(excluded.passport_url, esims.passport_url),
       status_qr = COALESCE(excluded.status_qr, esims.status_qr),
       plan_activated_at = COALESCE(excluded.plan_activated_at, esims.plan_activated_at),
       plan_expired_at = COALESCE(excluded.plan_expired_at, esims.plan_expired_at),
       data_package_mb = COALESCE(excluded.data_package_mb, esims.data_package_mb),
       data_left_mb = COALESCE(excluded.data_left_mb, esims.data_left_mb),
       data_used_mb = COALESCE(excluded.data_used_mb, esims.data_used_mb),
       updated_at = excluded.updated_at,
       synced_at = excluded.synced_at`,
  )
    .bind(
      info.iccid,
      extra.customerId ?? null,
      extra.orderId ?? null,
      info.id ?? null,
      extra.planId ?? info.active_plan_id ?? null,
      extra.label ?? null,
      extra.country ?? null,
      info.qrcode ?? null,
      info.ios_tap_link ?? null,
      info.esim_passport ?? null,
      info.status_qr ?? null,
      info.plan_activated_at ?? null,
      info.plan_expired_at ?? null,
      info.data_package_mb ?? null,
      info.data_left_mb ?? null,
      info.data_used_mb ?? null,
      now(),
      now(),
      now(),
    )
    .run();
}

/**
 * Refreshes rows older than `maxAgeMs` in one bulk call. Called from
 * GET /me/esims so the list a customer sees is current without hammering the
 * partner on every open.
 */
export async function refreshEsims(env: Env, iccids: string[]): Promise<void> {
  if (!iccids.length || !yesimConfigured(env)) return;
  const res = await bulkSimInfo(env, iccids);
  if (!res.ok) return;
  for (const info of res.data.data ?? []) {
    if (info?.iccid && !info.error) await storeSimInfo(env, info).catch(() => {});
  }
}

// ── the delivery provider ───────────────────────────────────────────────────

/** `iccid:planId` — check() needs both to say whether *this* plan landed. */
const refFor = (iccid: string, planId: string) => `${iccid}:${planId}`;
const parseRef = (ref: string) => {
  const i = ref.indexOf(':');
  return i > 0 ? { iccid: ref.slice(0, i), planId: ref.slice(i + 1) } : { iccid: ref, planId: null };
};

export function yesim(env: Env): DeliveryProvider {
  return {
    name: 'yesim',

    supports(req: DeliveryRequest) {
      // An eSIM product carries the Yesim plan id in `bundle_id`, exactly as a
      // data product carries the distributor's bundle id.
      return yesimConfigured(env) && req.product === 'esim' && Boolean(req.bundleId);
    },

    /**
     * Two provider calls, made idempotent by our own `esims` row.
     *
     * Issuing a profile and putting a plan on it are separate at Yesim, and a
     * failure between them would otherwise strand a paid-for, planless eSIM.
     * So the ICCID is written down the moment it is issued (or taken from the
     * order when this is a top-up of a profile the customer already has), and
     * a retry adds the plan to *that* ICCID rather than issuing another.
     */
    async deliver(req: DeliveryRequest): Promise<DeliveryOutcome> {
      const planId = req.bundleId!;
      const order = await env.DB.prepare(`SELECT customer_id, detail FROM orders WHERE id = ?`)
        .bind(req.orderId)
        .first<{ customer_id: string; detail: string }>();
      const customer = order;
      // What the customer bought, as the list will name it: "1 GB · Airtel Kenya".
      const label = order?.detail ?? undefined;

      // 1. Which profile: the top-up target, a profile this order already
      //    issued, or a fresh one.
      let iccid = req.iccid ?? null;
      if (!iccid) {
        const existing = await env.DB.prepare(`SELECT iccid FROM esims WHERE order_id = ?`)
          .bind(req.orderId)
          .first<{ iccid: string }>();
        iccid = existing?.iccid ?? null;
      }
      if (!iccid) {
        const issued = await newEsim(env);
        if (!issued.ok) {
          // Nothing was created if the API said no; a dead network is ambiguous
          // only in theory here (no ICCID exists for us to have missed) so it is
          // still a clean failure — the customer can be refunded or retried.
          return { status: 'failed', reason: `issue_failed: ${issued.error}` };
        }
        iccid = issued.data.iccid;
        await storeSimInfo(env, issued.data, {
          orderId: req.orderId,
          customerId: customer?.customer_id,
          country: req.country || undefined,
          label,
        }).catch(() => {});
      }

      // 2. The plan. From here on the ICCID is known, so any ambiguity is
      //    resolvable by check().
      const ref = refFor(iccid, planId);
      const added = await addPlanToIccid(env, iccid, planId);
      if (!added.ok) {
        if (added.status === undefined) return { status: 'unknown', providerRef: ref, reason: added.error };
        return { status: 'failed', reason: `add_plan_failed: ${added.error}` };
      }
      if (String(added.data.status).toLowerCase() !== 'success') {
        return { status: 'failed', reason: `add_plan_rejected: ${added.data.description ?? added.data.status}` };
      }

      // 3. Read back what the customer will need. Best effort — the plan is on
      //    the profile whether or not this read succeeds.
      const info = await simInfo(env, iccid);
      if (info.ok) {
        // A top-up relabels the profile with the newer plan; the row's order_id
        // stays the issuing order (COALESCE in storeSimInfo keeps the first).
        await storeSimInfo(env, info.data, {
          orderId: req.orderId,
          customerId: customer?.customer_id,
          planId,
          country: req.country || undefined,
          label,
        }).catch(() => {});
      }
      await env.DB.prepare(`UPDATE orders SET esim_iccid = ? WHERE id = ?`).bind(iccid, req.orderId).run().catch(() => {});
      return { status: 'delivered', providerRef: ref };
    },

    /** Did that plan land on that profile? Read from sim_info. */
    async check(providerRef: string): Promise<DeliveryOutcome> {
      const { iccid, planId } = parseRef(providerRef);
      const info = await simInfo(env, iccid);
      if (!info.ok) return { status: 'unknown', providerRef, reason: info.error };
      await storeSimInfo(env, info.data).catch(() => {});
      const active = info.data.active_plan_id;
      if (active && (!planId || String(active) === String(planId))) {
        return { status: 'delivered', providerRef };
      }
      return { status: 'pending', providerRef };
    },
  };
}
