import type { Env } from '../env';

/**
 * PawaPay — mobile money across West Africa. The customer approves a push on
 * their handset, so a deposit is asynchronous: we create it, then wait for the
 * callback (or poll) to learn the outcome.
 */

const CORRESPONDENT: Record<string, string> = {
  Orange: 'ORANGE_CIV',
  MTN: 'MTN_MOMO_CIV',
  Moov: 'MOOV_CIV',
};

export const supportsCarrier = (carrier: string) => carrier in CORRESPONDENT;

export type DepositResult =
  | { ok: true; depositId: string; status: 'pending' }
  | { ok: false; error: string };

const base = (env: Env) => (env.PAWAPAY_BASE_URL ?? 'https://api.sandbox.pawapay.io').replace(/\/+$/, '');

export async function createDeposit(
  env: Env,
  input: { depositId: string; amount: number; msisdn: string; carrier: string; description: string },
): Promise<DepositResult> {
  const correspondent = CORRESPONDENT[input.carrier];
  if (!correspondent) return { ok: false, error: 'carrier_unsupported' };

  // PawaPay wants the MSISDN in international form with no punctuation.
  const address = input.msisdn.replace(/\D/g, '').replace(/^0+/, '');

  try {
    const res = await fetch(`${base(env)}/deposits`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.PAWAPAY_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        depositId: input.depositId,
        // XOF has no minor unit, so the amount is sent as whole francs.
        amount: String(input.amount),
        currency: 'XOF',
        correspondent,
        payer: { type: 'MSISDN', address: { value: `225${address}` } },
        customerTimestamp: new Date().toISOString(),
        // Appears on the customer's mobile money statement; providers cap this.
        statementDescription: input.description.slice(0, 22),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => ({}))) as { status?: string; rejectionReason?: { rejectionMessage?: string } };
    if (!res.ok || body.status === 'REJECTED') {
      return { ok: false, error: body.rejectionReason?.rejectionMessage ?? `http_${res.status}` };
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
 * Callbacks are not signed, so the body is treated purely as a hint that
 * something changed — the outcome and the amount are always read back from the
 * API. A forged callback therefore cannot deliver an order.
 */
export async function fetchDeposit(
  env: Env,
  depositId: string,
): Promise<{ status: DepositStatus; amount: number | null }> {
  try {
    const res = await fetch(`${base(env)}/deposits/${encodeURIComponent(depositId)}`, {
      headers: { authorization: `Bearer ${env.PAWAPAY_API_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'pending', amount: null };

    const body = (await res.json()) as Array<{ status?: string; depositedAmount?: string; amount?: string }>;
    const record = Array.isArray(body) ? body[0] : (body as never);
    if (!record) return { status: 'pending', amount: null };

    const raw = record.status ?? '';
    const status: DepositStatus =
      raw === 'COMPLETED' ? 'captured' : raw === 'FAILED' || raw === 'REJECTED' ? 'failed' : 'pending';
    const amount = Number(record.depositedAmount ?? record.amount);
    return { status, amount: Number.isFinite(amount) ? amount : null };
  } catch {
    return { status: 'pending', amount: null };
  }
}
