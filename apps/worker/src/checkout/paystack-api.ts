import { timingSafeEqual, type Env } from '../env';

/**
 * Paystack — cards and bank transfer. Synchronous redirect: we initialise a
 * transaction, send the customer to the authorization URL, then confirm the
 * outcome against the API rather than trusting the webhook body.
 *
 * Amount convention is Paystack's own and does not follow ISO 4217: every
 * currency is sent multiplied by 100, including XOF, which has no subunit
 * under ISO. Passing ISO minor units here would undercharge XOF by 100×, so
 * this module takes the major amount and does the conversion itself.
 */

/** Paystack's stated per-currency minimum, in the major unit. */
const MINIMUMS: Record<string, number> = {
  NGN: 50,
  GHS: 0.1,
  ZAR: 1,
  KES: 3,
  USD: 2,
  XOF: 100,
};

export const SUPPORTED = Object.keys(MINIMUMS);

export const belowMinimum = (amount: number, currency: string) => {
  const min = MINIMUMS[currency.toUpperCase()];
  return typeof min === 'number' && amount < min;
};

/** Paystack subunit: always ×100, whatever ISO says about the currency. */
const toSubunit = (amount: number) => Math.round(amount * 100);

export type InitResult =
  | { ok: true; reference: string; authorizationUrl: string }
  | { ok: false; error: string };

export async function initialise(
  env: Env,
  input: {
    reference: string;
    /** Major unit — ₦100 is `100`. Converted to Paystack's subunit here. */
    amount: number;
    currency: string;
    email: string;
    callbackUrl: string;
    orderId: string;
  },
): Promise<InitResult> {
  const currency = input.currency.toUpperCase();
  if (!MINIMUMS[currency]) return { ok: false, error: `currency_unsupported:${currency}` };
  // Rejecting here is clearer than letting Paystack decline the transaction.
  if (belowMinimum(input.amount, currency))
    return { ok: false, error: `below_minimum:${MINIMUMS[currency]}_${currency}` };

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reference: input.reference,
        amount: toSubunit(input.amount),
        currency,
        email: input.email,
        callback_url: input.callbackUrl,
        metadata: { order_id: input.orderId },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    };
    if (!res.ok || !body.status || !body.data?.authorization_url) {
      return { ok: false, error: body.message ?? `http_${res.status}` };
    }
    return {
      ok: true,
      reference: body.data.reference ?? input.reference,
      authorizationUrl: body.data.authorization_url,
    };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}

/** HMAC-SHA512 of the raw body, keyed with the secret. Compared in constant time. */
export async function verifySignature(header: string | null, rawBody: string, secret: string) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, header.trim());
}

export type VerifyResult = { status: 'pending' | 'captured' | 'failed'; amount: number | null };

/** Reads the authoritative outcome back from Paystack. */
export async function verifyTransaction(env: Env, reference: string): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return { status: 'pending', amount: null };

    const body = (await res.json()) as { data?: { status?: string; amount?: number } };
    const raw = body.data?.status;
    const status =
      raw === 'success' ? 'captured' : raw === 'failed' || raw === 'abandoned' ? 'failed' : 'pending';
    // Converted back out of Paystack's subunit so the caller compares like
    // with like against what it asked to charge.
    const amount = typeof body.data?.amount === 'number' ? body.data.amount / 100 : null;
    return { status, amount };
  } catch {
    return { status: 'pending', amount: null };
  }
}
