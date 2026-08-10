import type { Env } from '../env';

/**
 * PawaPay v2 — mobile money across Africa. The customer approves a push on
 * their handset, so a deposit is asynchronous: we create it, then read the
 * outcome back (never trust the callback body).
 *
 * Nothing here is hardcoded to one market. The provider, the country and the
 * canonical MSISDN all come from `/v2/predict-provider`, so a customer paying
 * from Ouagadougou is charged on ORANGE_BFA in XOF exactly as one in Abidjan
 * is charged on ORANGE_CIV — without this file carrying a numbering plan it
 * would have to keep in step with every range reallocation.
 */

const base = (env: Env) => (env.PAWAPAY_BASE_URL ?? 'https://api.sandbox.pawapay.io').replace(/\/+$/, '');

const headers = (env: Env) => ({
  authorization: `Bearer ${env.PAWAPAY_API_TOKEN}`,
  'content-type': 'application/json',
});

// PawaPay caps the note shown on the customer's statement at 4–22 characters.
const customerMessage = (text: string) => {
  const trimmed = text.trim().slice(0, 22);
  return trimmed.length >= 4 ? trimmed : 'Payment';
};

export type Prediction = { provider: string; country: string; msisdn: string };

/**
 * Resolves which wallet a number belongs to.
 *
 * This is the whole reason the checkout is market-agnostic: it answers with the
 * provider code, the ISO-3 country and the number in the exact form the deposit
 * call wants, so none of those have to be guessed from a prefix.
 */
export async function predictProvider(env: Env, phoneNumber: string): Promise<Prediction | null> {
  try {
    const res = await fetch(`${base(env)}/v2/predict-provider`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({ phoneNumber }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Prediction>;
    return body.provider && body.country && body.msisdn
      ? { provider: body.provider, country: body.country, msisdn: body.msisdn }
      : null;
  } catch {
    return null;
  }
}

export type DepositResult =
  | { ok: true; depositId: string; status: 'pending' }
  | { ok: false; error: string };

export async function createDeposit(
  env: Env,
  input: {
    depositId: string;
    amount: number;
    currency: string;
    phoneNumber: string;
    provider: string;
    orderId: string;
    description: string;
  },
): Promise<DepositResult> {
  try {
    const res = await fetch(`${base(env)}/v2/deposits`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({
        depositId: input.depositId,
        // Sent as a decimal string. XOF has no minor unit, so this is whole francs.
        amount: String(input.amount),
        currency: input.currency,
        payer: {
          type: 'MMO',
          accountDetails: { provider: input.provider, phoneNumber: input.phoneNumber },
        },
        clientReferenceId: input.orderId,
        customerMessage: customerMessage(input.description),
        metadata: [{ orderId: input.orderId }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      failureReason?: { failureCode?: string; failureMessage?: string };
    };
    if (!res.ok || body.status === 'REJECTED') {
      return {
        ok: false,
        error: body.failureReason?.failureCode ?? body.failureReason?.failureMessage ?? `http_${res.status}`,
      };
    }
    return { ok: true, depositId: input.depositId, status: 'pending' };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}

export type DepositStatus = 'pending' | 'captured' | 'failed';

/**
 * Asks PawaPay what actually happened.
 *
 * Callbacks are not trusted as evidence — the outcome and the amount are always
 * read back from here, so a forged callback cannot deliver an order.
 */
export async function fetchDeposit(
  env: Env,
  depositId: string,
): Promise<{ status: DepositStatus; amount: number | null }> {
  try {
    const res = await fetch(`${base(env)}/v2/deposits/${encodeURIComponent(depositId)}`, {
      headers: headers(env),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'pending', amount: null };

    // v2 wraps the record: { status: 'FOUND', data: { ... } }. Treating this as
    // the v1 array meant COMPLETED was never seen and deposits hung pending.
    const body = (await res.json()) as {
      status?: string;
      data?: { status?: string; amount?: string };
    };
    if (body.status === 'NOT_FOUND' || !body.data) return { status: 'pending', amount: null };

    const raw = body.data.status ?? '';
    const status: DepositStatus =
      raw === 'COMPLETED' ? 'captured' : raw === 'FAILED' || raw === 'REJECTED' ? 'failed' : 'pending';
    const amount = Number(body.data.amount);
    return { status, amount: Number.isFinite(amount) ? amount : null };
  } catch {
    return { status: 'pending', amount: null };
  }
}
