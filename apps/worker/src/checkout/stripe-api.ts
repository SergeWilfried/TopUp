import type { Env } from '../env';

/**
 * Stripe — international cards, used for one-off catalogue purchases. VPN
 * subscriptions are handled separately in vpn/billing.ts; the two are told
 * apart by the `order_id` metadata this attaches.
 */

export type SessionResult = { ok: true; url: string; sessionId: string } | { ok: false; error: string };

export async function createCheckoutSession(
  env: Env,
  input: {
    orderId: string;
    /** Already in the smallest unit of `currency` — cents, not francs. */
    minorAmount: number;
    currency: string;
    name: string;
    email?: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<SessionResult> {
  // Stripe does not settle XOF. The caller must have converted to a currency
  // Stripe supports; sending francs here would be rejected outright.
  if (input.currency.toUpperCase() === 'XOF') return { ok: false, error: 'xof_unsupported_by_stripe' };

  const form = new URLSearchParams({
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(input.minorAmount),
    'line_items[0][price_data][product_data][name]': input.name,
    // Read back on the webhook to fulfil the right order — and to keep a
    // catalogue purchase from being mistaken for a VPN subscription.
    'metadata[order_id]': input.orderId,
    'payment_intent_data[metadata][order_id]': input.orderId,
  });
  if (input.email) form.set('customer_email', input.email);

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        // Retries of the same order must not create a second session.
        'idempotency-key': `checkout_${input.orderId}`,
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !body.url || !body.id) {
      return { ok: false, error: body.error?.message ?? `http_${res.status}` };
    }
    return { ok: true, url: body.url, sessionId: body.id };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}
