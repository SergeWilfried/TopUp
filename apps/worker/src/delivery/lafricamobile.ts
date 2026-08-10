import { diallingCodeFor } from '@topup/core';
import type { Env } from '../env';
import type { DeliveryOutcome, DeliveryProvider, DeliveryRequest } from './types';

/**
 * LAfricaMobile — airtime and data distribution across West Africa.
 *
 * Two things about this API shape the code more than anything else:
 *
 *  1. **Errors arrive as HTTP 200.** A bad login returns `200 OK` with
 *     `{"message":"Login ou Mot de passe incorrect !"}`. Checking `res.ok`
 *     alone would read an auth failure as a successful empty response — so
 *     every call is validated on the presence of the fields it should return,
 *     not on the status code.
 *  2. **There is no idempotency key on send.** `POST /airtime` accepts no
 *     client reference; `partner_transaction_id` comes back in the response
 *     rather than going in. So a request we never saw the reply to cannot be
 *     safely repeated, which is exactly why `delivery_unknown` exists and is
 *     never auto-retried.
 */

const DEFAULT_BASE = 'https://airtime.lafricamobile.com';

const base = (env: Env) => (env.LAFRICAMOBILE_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');

const configured = (env: Env) => Boolean(env.LAFRICAMOBILE_LOGIN && env.LAFRICAMOBILE_PASSWORD);

/**
 * Rejects the "200 with an error message" case.
 *
 * Returns the body only when it carries `expect`; anything else — an error
 * message, an empty object, a truncated response — is treated as a failure
 * with the message the API gave us.
 */
function payload<T>(body: unknown, expect: keyof T & string): { ok: true; data: T } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'malformed_response' };
  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string') return { ok: false, error: record.message };
  if (!(expect in record)) return { ok: false, error: 'malformed_response' };
  return { ok: true, data: body as T };
}

/**
 * International form, digits only — the format the `telephone` field wants
 * (`221772345678` in their example). Numbers are stored nationally because
 * that is the account identifier, so the recipient's country supplies the
 * prefix.
 */
function internationalDigits(msisdn: string, country: string): string | null {
  const digits = msisdn.replace(/\D/g, '');
  const code = diallingCodeFor(country);
  if (!code) return null;
  if (digits.startsWith(code)) return digits;
  return `${code}${digits.replace(/^0+/, '')}`;
}

/**
 * Operator codes, from LAfricaMobile's published list.
 *
 * Keyed by country *and* network, because the codes are country-scoped —
 * `ORANGECI` and `ORANGEBF` are different products, and an unqualified
 * "ORANGE" is not a code at all.
 *
 * Three entries carry a rebrand the catalogue does not use, so the network name
 * we sell under is not the name LAM lists:
 *
 *  - Senegal's `Free` is LAM's `TIGO SN` — Tigo Sénégal became Free in 2019.
 *  - Burkina's `Moov` is `TELMOBBF` — Telmob is Onatel's mobile brand, now
 *    trading as Moov Africa.
 *  - Mali's `Moov` is `MALITEL`, the same rebrand a market over.
 *
 * There is deliberately no fallback. An unknown pair returns null and the order
 * is refused, because a guessed code either fails every transaction or — far
 * worse — names a real operator in the wrong country.
 */
const OPERATOR_CODES: Record<string, Record<string, string>> = {
  SN: { Orange: 'ORANGESN', Free: 'TIGOSN', Tigo: 'TIGOSN', Expresso: 'EXPSN' },
  ML: { Orange: 'ORANGEML', Moov: 'MALITEL', Malitel: 'MALITEL', Telecel: 'TELECELML' },
  CI: { Orange: 'ORANGECI', MTN: 'MTNCI', Moov: 'MOOVCI' },
  BF: { Orange: 'ORANGEBF', Telecel: 'TELECELBF', Moov: 'TELMOBBF', Telmob: 'TELMOBBF' },
  NE: { Airtel: 'AIRTELNE', Moov: 'MOOVNE', Orange: 'ORANGENE', Zamani: 'ORANGENE' },
  BJ: { MTN: 'MTNBJ', Moov: 'MOOVBJ' },
};

/** Countries LAfricaMobile can deliver airtime to at all. */
export const LAM_COUNTRIES = Object.keys(OPERATOR_CODES);

export const operatorCodeFor = (country: string, network: string | null) =>
  (network && OPERATOR_CODES[country.toUpperCase()]?.[network]) || null;

/** `SENT` and `PENDING` both mean "not finished"; only `SUCCESSFUL` is delivery. */
function mapStatus(raw: string, ref: string | null): DeliveryOutcome {
  switch (raw.toUpperCase()) {
    case 'SUCCESSFUL':
      return ref
        ? { status: 'delivered', providerRef: ref }
        : { status: 'unknown', providerRef: null, reason: 'successful_without_reference' };
    case 'FAILED':
      return { status: 'failed', reason: 'provider_failed' };
    case 'PENDING':
    case 'SENT':
      return ref
        ? { status: 'pending', providerRef: ref }
        : { status: 'unknown', providerRef: null, reason: 'pending_without_reference' };
    default:
      return { status: 'unknown', providerRef: ref, reason: `unmapped_status:${raw}` };
  }
}

// ── float ───────────────────────────────────────────────────────────────────
export type Balance = { country: string; balance: number };

/**
 * Remaining float, per country.
 *
 * Airtime distribution fails first by running out of money, not by breaking,
 * so this is the number that wants a threshold alert on it. Credentials go in
 * the query string — their design, not ours — so the built URL is never logged.
 */
export async function checkBalance(env: Env): Promise<{ ok: true; balances: Balance[] } | { ok: false; error: string }> {
  if (!configured(env)) return { ok: false, error: 'not_configured' };

  const url = new URL(`${base(env)}/credit`);
  url.searchParams.set('login', env.LAFRICAMOBILE_LOGIN!);
  url.searchParams.set('password', env.LAFRICAMOBILE_PASSWORD!);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => null)) as unknown;

    // Documented as returning an array, while the schema section describes a
    // flat object. Both are accepted rather than trusting either.
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0) return { ok: true, balances: [] };

    const first = payload<{ country: string; balance: string }>(rows[0], 'country');
    if (!first.ok) return { ok: false, error: first.error };

    return {
      ok: true,
      balances: (rows as Array<{ country?: string; balance?: string }>)
        .filter((r) => r && typeof r.country === 'string')
        .map((r) => ({ country: r.country!, balance: Number(r.balance ?? 0) })),
    };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}

// ── the provider ────────────────────────────────────────────────────────────
type SendResponse = {
  gu_transaction_id: string;
  status: string;
  partner_transaction_id?: string;
  amount?: string;
};

type StatusResponse = {
  gu_transaction_id: string;
  status: string;
  partner_transaction_id?: string;
  amount?: number;
};

export function lafricamobile(env: Env): DeliveryProvider {
  return {
    name: 'lafricamobile',

    supports(req: DeliveryRequest) {
      if (!configured(env)) return false;
      // Airtime and data bundles only. A data bundle additionally needs a
      // `bundleid`, which we do not carry on products yet — so data is left to
      // another provider rather than sent as if it were airtime.
      if (req.product !== 'airtime') return false;
      return Boolean(operatorCodeFor(req.country, req.network) && internationalDigits(req.msisdn, req.country));
    },

    async deliver(req: DeliveryRequest): Promise<DeliveryOutcome> {
      const telephone = internationalDigits(req.msisdn, req.country);
      const operateur = operatorCodeFor(req.country, req.network);
      if (!telephone || !operateur) return { status: 'failed', reason: 'unroutable_recipient' };

      let res: Response;
      try {
        res = await fetch(`${base(env)}/airtime`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            login: env.LAFRICAMOBILE_LOGIN,
            password: env.LAFRICAMOBILE_PASSWORD,
            montant: String(req.amount),
            telephone,
            operateur,
            // Their callback is an acknowledgement, not evidence: the outcome is
            // always read back from /checkstatus, same rule as every other rail.
            ...(env.PUBLIC_BASE_URL ? { callback: `${env.PUBLIC_BASE_URL}/checkout/callback/lafricamobile` } : {}),
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        // Never saw the reply. With no idempotency key on send, the transfer may
        // or may not have happened and must not be repeated.
        return { status: 'unknown', providerRef: null, reason: `unreachable: ${(e as Error).message}` };
      }

      const body = (await res.json().catch(() => null)) as unknown;
      const parsed = payload<SendResponse>(body, 'gu_transaction_id');
      if (!parsed.ok) {
        // A rejected request is a clean failure — nothing was sent — but only
        // when the API actually answered. A 5xx with no body is ambiguous.
        return res.status >= 500
          ? { status: 'unknown', providerRef: null, reason: parsed.error }
          : { status: 'failed', reason: parsed.error };
      }

      return mapStatus(parsed.data.status, parsed.data.gu_transaction_id);
    },

    /** Resolves `delivering` and `delivery_unknown` against the provider's own record. */
    async check(providerRef: string): Promise<DeliveryOutcome> {
      const url = new URL(`${base(env)}/checkstatus`);
      url.searchParams.set('gu_transaction_id', providerRef);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const parsed = payload<StatusResponse>(await res.json().catch(() => null), 'status');
        if (!parsed.ok) return { status: 'unknown', providerRef, reason: parsed.error };
        return mapStatus(parsed.data.status, providerRef);
      } catch (e) {
        return { status: 'unknown', providerRef, reason: `unreachable: ${(e as Error).message}` };
      }
    },
  };
}
