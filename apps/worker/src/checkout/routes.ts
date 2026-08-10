import { Hono } from 'hono';
import { days, now, type Env } from '../env';
import { translator } from '../i18n';
import * as pawapay from './pawapay-api';
import * as paystack from './paystack-api';
import * as stripe from './stripe-api';
import { isQuoteError, loadRates, quoteFor, type Quote } from './pricing';
import { canDeliver, deliverOrder } from '../delivery';
import { MOBILE_MONEY_CARRIERS, diallingCodeFor, iso3For, routeForCountry, toMinorUnits } from '@topup/core';
import { normaliseMsisdn } from '../vpn/auth';

/**
 * Checkout.
 *
 * Three rules hold everywhere in here:
 *
 *  1. The price comes from the `products` row, never from the request. A client
 *     that can name its own price can buy a year of VPN for one franc.
 *  2. A callback body is a hint that something changed, never the outcome. The
 *     status and the amount are read back from the provider's API before an
 *     order is fulfilled.
 *  3. Fulfilment is guarded by a status transition, so a redelivered callback
 *     cannot deliver twice.
 */
const checkout = new Hono<{ Bindings: Env }>();

checkout.use('/*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});

type ProductRow = {
  id: string;
  type: string;
  name: string;
  name_key: string | null;
  price: number;
  days: number | null;
  enabled: number;
  network: string | null;
};

const PROVIDERS = ['pawapay', 'paystack', 'stripe'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Puts a national number into international form for provider prediction.
 *
 * The dialling code comes from the country doing the *paying*. A Burkinabè
 * customer buying an eSIM for China pays on a +226 wallet; the destination has
 * no bearing on the rail, and reading the prefix off the product would charge
 * the wrong market — or nothing at all.
 */
const internationalise = (msisdn: string, payerCountry: string) => {
  const raw = msisdn.trim();
  const digits = raw.replace(/\D/g, '');

  // Already international. Left exactly as given so the prediction reports the
  // number's true country and the cross-check below can catch a mismatch —
  // prefixing it again turned a Côte d'Ivoire number into a nonexistent
  // Burkinabè one that would have failed opaquely at the provider.
  if (raw.startsWith('+') || digits.startsWith('00')) return `+${digits.replace(/^00/, '')}`;

  // A national number only means anything in its own country, so the buyer's
  // dialling code is the right reading.
  const code = diallingCodeFor(payerCountry);
  if (!code) return null;
  return `+${code}${digits.replace(/^0+/, '')}`;
};

/**
 * Finds or creates the telco account behind an MSISDN.
 *
 * Stored in the same normalised form the auth layer uses, so signing in by
 * phone links to the account that placed the orders. Storing the number as
 * typed meant the two never matched.
 */
async function upsertCustomer(env: Env, raw: string, carrier: string, country: string) {
  // Canonical E.164, matching the identity the auth layer stores — this link is
  // the only thing joining a phone sign-in to the orders placed from it.
  const msisdn = raw.startsWith('email:') ? raw : normaliseMsisdn(raw, country);
  if (!msisdn) return null;
  const existing = await env.DB.prepare(`SELECT id FROM customers WHERE msisdn = ?`)
    .bind(msisdn)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = `C-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO customers (id, msisdn, name, carrier, points, created_at) VALUES (?, ?, NULL, ?, 0, ?)`,
  )
    .bind(id, msisdn, carrier, now())
    .run();
  return id;
}

/**
 * What a customer in this country can pay with, and what they will be charged.
 *
 * The app asks before rendering the payment step so it never offers a rail the
 * backend would reject — Stripe cannot take XOF, PawaPay only works where the
 * carriers do.
 */
checkout.get('/methods', async (c) => {
  const country = (c.req.query('country') ?? '').toUpperCase();
  const route = routeForCountry(country);
  if (!route) return c.json({ country, supported: false, methods: [] }, 200);

  const productId = c.req.query('productId');
  const rates = await loadRates(c.env);

  let quote: Quote | null = null;
  if (productId) {
    const product = await c.env.DB.prepare(`SELECT price FROM products WHERE id = ? AND enabled = 1`)
      .bind(productId)
      .first<{ price: number }>();
    if (!product) return c.json({ error: 'unknown_product', field: 'productId' }, 404);
    const q = quoteFor(product.price, country, rates);
    if (isQuoteError(q)) return c.json({ error: q.error }, q.status as 422);
    quote = q;
  }

  return c.json({
    country,
    supported: true,
    provider: route.provider,
    currency: route.currency,
    carriers: (MOBILE_MONEY_CARRIERS as Record<string, string[]>)[country] ?? [],
    quote,
  });
});

// ── start a purchase ───────────────────────────────────────────────────────
checkout.post('/', async (c) => {
  type Body = {
    productId?: string;
    /** The wallet being charged. Belongs to the buyer, whoever the order is for. */
    msisdn?: string;
    /** Where the pack is delivered, when that is not the buyer's own line. */
    recipientMsisdn?: string;
    /** ISO-2 of the recipient's line. Decides the dialling code at delivery. */
    recipientCountry?: string;
    email?: string;
    /** Where the buyer is paying from — unrelated to where an eSIM is used. */
    country?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  // The rail is derived from where the customer is, not chosen by the client:
  // a request asking for Stripe from Abidjan would be charged in a currency
  // Stripe cannot settle.
  const country = (body.country ?? '').toUpperCase();
  const route = routeForCountry(country);
  if (!route) return c.json({ error: 'country_unsupported', field: 'country' }, 422);
  const provider = route.provider as Provider;

  const msisdn = (body.msisdn ?? '').trim();
  const recipientMsisdn = (body.recipientMsisdn ?? '').trim();
  // Falls back to the buyer's country: topping up your own line is the common case.
  const recipientCountry = (body.recipientCountry ?? country).toUpperCase();
  // Mobile money is charged to a handset; card rails are not.
  if (provider === 'pawapay' && msisdn.replace(/\D/g, '').length < 8)
    return c.json({ error: 'msisdn_invalid', field: 'msisdn' }, 400);

  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`)
    .bind(body.productId ?? '')
    .first<ProductRow>();
  if (!product) return c.json({ error: 'unknown_product', field: 'productId' }, 404);
  // A disabled product must not be purchasable, even by a stale client.
  if (!product.enabled) return c.json({ error: 'product_unavailable', field: 'productId' }, 409);

  /**
   * Which wallet to charge.
   *
   * PawaPay is asked rather than guessed: it returns the provider code, the
   * country and the number in canonical form. The predicted country is then
   * checked against the country we are pricing for — a Senegalese number sent
   * with `country=BF` would otherwise be charged on the wrong market's rail.
   */
  let prediction: pawapay.Prediction | null = null;
  if (provider === 'pawapay') {
    const international = internationalise(msisdn, country);
    if (!international) return c.json({ error: 'country_unsupported', field: 'country' }, 422);

    prediction = await pawapay.predictProvider(c.env, international);
    if (!prediction) return c.json({ error: 'carrier_unknown', field: 'msisdn' }, 400);

    const expected = iso3For(country);
    if (expected && prediction.country !== expected)
      return c.json({ error: 'msisdn_country_mismatch', field: 'msisdn' }, 400);
  }
  // Recorded against the customer for display; the rail uses the prediction.
  const carrier = prediction ? prediction.provider : null;
  /**
   * Refuse an order nothing can deliver, before any money moves.
   *
   * Payability and deliverability are separate questions — a Kenyan number is
   * perfectly chargeable and has no airtime rail — and discovering the second
   * one after capture leaves a charged customer awaiting a refund.
   */
  if (product.type === 'airtime' || product.type === 'data') {
    const deliverable = canDeliver(c.env, {
      orderId: 'preflight',
      product: product.type,
      sku: product.id,
      amount: product.price,
      msisdn: recipientMsisdn || msisdn,
      country: recipientCountry,
      network: product.network,
    });
    if (!deliverable) {
      return c.json({ error: 'recipient_undeliverable', field: 'recipientMsisdn' }, 422);
    }
  }

  // Card rails need somewhere to send the receipt.
  if (provider !== 'pawapay' && !body.email) return c.json({ error: 'email_required', field: 'email' }, 400);

  const rates = await loadRates(c.env);
  const quote = quoteFor(product.price, country, rates);
  if (isQuoteError(quote)) return c.json({ error: quote.error }, quote.status as 422);

  const t = translator('en');
  const name = product.name_key ? t(product.name_key) : product.name;
  const customerId = await upsertCustomer(
    c.env,
    msisdn || `email:${body.email}`,
    carrier ?? 'Card',
    country,
  );
  if (!customerId) return c.json({ error: 'msisdn_invalid', field: 'msisdn' }, 400);

  const orderId = `TX-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const paymentId = crypto.randomUUID();
  // The order is always recorded in XOF; the payment records what was charged.
  const amount = product.price;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO orders (id, customer_id, product, sku, detail, amount, status, created_at, recipient_msisdn, recipient_country)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(
      orderId,
      customerId,
      product.type,
      product.id,
      name,
      amount,
      now(),
      recipientMsisdn ? normaliseMsisdn(recipientMsisdn, recipientCountry) : null,
      recipientCountry,
    ),
    c.env.DB.prepare(
      `INSERT INTO payments (id, order_id, provider, provider_ref, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).bind(paymentId, orderId, provider, paymentId, quote.minorAmount, quote.currency, now()),
  ]);

  const fail = async (reason: string) => {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).bind(paymentId),
      c.env.DB.prepare(`UPDATE orders SET status = 'failed', failure_reason = ? WHERE id = ?`).bind(
        reason,
        orderId,
      ),
    ]);
    return c.json({ error: 'payment_failed', reason, orderId }, 502);
  };

  if (provider === 'pawapay') {
    const result = await pawapay.createDeposit(c.env, {
      depositId: paymentId,
      amount: quote.amount,
      // The market's currency, not a constant: the same code has to serve XOF
      // in Ouagadougou and RWF in Kigali.
      currency: quote.currency,
      phoneNumber: prediction!.msisdn,
      provider: prediction!.provider,
      orderId,
      description: name,
    });
    if (!result.ok) return fail(result.error);
    // The customer approves on their handset; the app polls GET /checkout/:id.
    return c.json({ orderId, paymentId, status: 'pending', action: 'approve_on_handset', quote }, 201);
  }

  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;

  if (provider === 'paystack') {
    const result = await paystack.initialise(c.env, {
      reference: paymentId,
      amount: quote.amount,
      currency: quote.currency,
      email: body.email!,
      callbackUrl: `${baseUrl}/checkout/return/${orderId}`,
      orderId,
    });
    if (!result.ok) return fail(result.error);
    return c.json(
      { orderId, paymentId, status: 'pending', action: 'redirect', url: result.authorizationUrl, quote },
      201,
    );
  }

  const session = await stripe.createCheckoutSession(c.env, {
    orderId,
    minorAmount: quote.minorAmount,
    currency: quote.currency,
    name,
    email: body.email,
    successUrl: `${baseUrl}/checkout/return/${orderId}`,
    cancelUrl: `${baseUrl}/checkout/return/${orderId}?cancelled=1`,
  });
  if (!session.ok) return fail(session.error);
  await c.env.DB.prepare(`UPDATE payments SET provider_ref = ? WHERE id = ?`)
    .bind(session.sessionId, paymentId)
    .run();
  return c.json({ orderId, paymentId, status: 'pending', action: 'redirect', url: session.url, quote }, 201);
});

// ── status ─────────────────────────────────────────────────────────────────
// How long a provider answer is reused for. Client polling is the app's source
// of truth, so without this each poll would be an API call to the provider.
const RECONCILE_EVERY_MS = 4000;

/**
 * Brings a still-pending payment up to date from the provider.
 *
 * Callbacks are the fast path, but they get lost and they are not signed. If
 * the only route to `delivered` were a callback, one dropped request would
 * leave a paying customer watching a spinner until the app gave up.
 */
async function reconcile(env: Env, orderId: string) {
  const payment = await env.DB.prepare(
    `SELECT p.id, p.provider, p.status, p.checked_at
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE o.id = ? AND o.status = 'pending' AND p.status = 'pending'
     ORDER BY p.created_at DESC LIMIT 1`,
  )
    .bind(orderId)
    .first<{ id: string; provider: string; status: string; checked_at: number | null }>();

  // Only PawaPay is reconciled on read so far; the card rails still rely on
  // their callbacks, which arrive over a channel we control the return URL for.
  if (!payment || payment.provider !== 'pawapay') return;
  if (payment.checked_at && now() - payment.checked_at < RECONCILE_EVERY_MS) return;

  await env.DB.prepare(`UPDATE payments SET checked_at = ? WHERE id = ?`).bind(now(), payment.id).run();

  const state = await pawapay.fetchDeposit(env, payment.id);
  if (state.status === 'captured') await fulfil(env, payment.id, state.amount);
  else if (state.status === 'failed') {
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'`).bind(payment.id),
      env.DB.prepare(
        `UPDATE orders SET status = 'failed', failure_reason = COALESCE(failure_reason, 'provider_failed') WHERE id = ? AND status = 'pending'`,
      ).bind(orderId),
    ]);
  }
}

checkout.get('/:orderId', async (c) => {
  await reconcile(c.env, c.req.param('orderId'));

  const order = await c.env.DB.prepare(
    `SELECT o.id, o.status, o.detail, o.amount, o.failure_reason AS failureReason,
            p.provider, p.status AS paymentStatus
     FROM orders o
     LEFT JOIN payments p ON p.id = (
       SELECT id FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE o.id = ?`,
  )
    .bind(c.req.param('orderId'))
    .first();
  return order ? c.json(order) : c.json({ error: 'not_found' }, 404);
});

// ── fulfilment ─────────────────────────────────────────────────────────────
/**
 * Marks a payment captured and the order delivered.
 *
 * The UPDATE is conditional on the payment still being pending, so a repeated
 * callback changes nothing: `meta.changes` is 0 the second time and fulfilment
 * is skipped rather than run twice.
 */
async function fulfil(env: Env, paymentId: string, paidAmount: number | null) {
  const payment = await env.DB.prepare(
    `SELECT p.*, o.id AS orderId, o.amount AS orderAmount, o.sku, o.product
     FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? OR p.provider_ref = ?`,
  )
    .bind(paymentId, paymentId)
    .first<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      orderId: string;
      orderAmount: number;
      sku: string | null;
      product: string;
    }>();
  if (!payment) return { ok: false, reason: 'unknown_payment' };

  // Underpayment must never deliver. Providers occasionally settle a different
  // figure than requested; treat any shortfall as a failure to investigate.
  // Compared against the payment, not the order: the order is in XOF while the
  // charge may have been in EUR or NGN.
  if (paidAmount !== null && paidAmount < payment.amount) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).bind(payment.id),
      env.DB.prepare(
        `UPDATE orders SET status = 'failed', failure_reason = 'amount_mismatch' WHERE id = ?`,
      ).bind(payment.orderId),
    ]);
    return { ok: false, reason: 'amount_mismatch' };
  }

  const claim = await env.DB.prepare(
    `UPDATE payments SET status = 'captured', settled_at = ? WHERE id = ? AND status = 'pending'`,
  )
    .bind(now(), payment.id)
    .run();
  if (claim.meta.changes === 0) return { ok: true, reason: 'already_settled' };

  // Paid, not delivered. Those are different events and conflating them meant
  // every dashboard figure counted money taken as goods shipped, and a top-up
  // that never reached the customer looked identical to one that did.
  await env.DB.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`)
    .bind(payment.orderId)
    .run();

  // VPN is delivered by this Worker — the grant is a row we own, so it is
  // immediate and cannot half-happen.
  if (payment.product === 'vpn') {
    await grantVpn(env, payment.orderId, payment.sku);
    await env.DB.prepare(`UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?`)
      .bind(now(), payment.orderId)
      .run();
    return { ok: true, reason: 'delivered' };
  }

  // Airtime, data and eSIM go to an external rail. Deliberately awaited rather
  // than fired into the background: a Worker stops executing once it responds,
  // so a floating promise here would be cancelled mid-request and leave the
  // order stuck in `delivering` with no provider reference to reconcile.
  await deliverOrder(env, payment.orderId);
  return { ok: true, reason: 'paid' };
}

/** Adds subscription time for a VPN purchase, keyed to the buyer's email. */
async function grantVpn(env: Env, orderId: string, sku: string | null) {
  const plan = sku
    ? await env.DB.prepare(`SELECT days, name FROM products WHERE id = ?`)
        .bind(sku)
        .first<{ days: number | null; name: string }>()
    : null;
  const grant = days(plan?.days ?? 30);

  const buyer = await env.DB.prepare(
    `SELECT c.msisdn, u.id AS userId FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = c.vpn_user_id
     WHERE o.id = ?`,
  )
    .bind(orderId)
    .first<{ msisdn: string; userId: string | null }>();

  if (!buyer?.userId) {
    // No VPN account is linked yet: the customer claims it by signing in with
    // the email they used, at which point the control plane owns the grant.
    console.warn(`VPN order ${orderId} has no linked account; grant deferred`);
    return;
  }

  const user = await env.DB.prepare(`SELECT sub_expires_at FROM users WHERE id = ?`)
    .bind(buyer.userId)
    .first<{ sub_expires_at: number | null }>();
  const base = Math.max(user?.sub_expires_at ?? 0, now());
  await env.DB.prepare(
    `UPDATE users SET sub_expires_at = ?, sub_started_at = COALESCE(sub_started_at, ?), plan = ? WHERE id = ?`,
  )
    .bind(base + grant, now(), plan?.name ?? 'VPN', buyer.userId)
    .run();
}

// ── provider callbacks ─────────────────────────────────────────────────────
checkout.post('/callback/pawapay', async (c) => {
  const body = await c.req.json<{ depositId?: string }>().catch((): { depositId?: string } => ({}));
  if (!body.depositId) return c.json({ error: 'deposit_id_required' }, 400);

  // The body is unsigned, so it is only a nudge — the truth comes from the API.
  const state = await pawapay.fetchDeposit(c.env, body.depositId);
  if (state.status === 'pending') return c.json({ received: true, status: 'pending' });

  if (state.status === 'failed') {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'`).bind(
        body.depositId,
      ),
      c.env.DB.prepare(
        `UPDATE orders SET status = 'failed', failure_reason = 'declined'
         WHERE id = (SELECT order_id FROM payments WHERE id = ?) AND status = 'pending'`,
      ).bind(body.depositId),
    ]);
    return c.json({ received: true, status: 'failed' });
  }

  const result = await fulfil(c.env, body.depositId, state.amount);
  return c.json({ received: true, ...result });
});

checkout.post('/callback/paystack', async (c) => {
  const raw = await c.req.text();
  const ok = await paystack.verifySignature(
    c.req.header('x-paystack-signature') ?? null,
    raw,
    c.env.PAYSTACK_SECRET_KEY,
  );
  if (!ok) return c.json({ error: 'bad_signature' }, 400);

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: 'malformed_event' }, 400);
  }

  const reference = event.data?.reference;
  if (!reference) return c.json({ received: true, skipped: 'no_reference' });

  const state = await paystack.verifyTransaction(c.env, reference);
  // Paystack reports the major unit; payments.amount is ISO minor. Normalise
  // before comparing, or a €9.15 charge looks like an underpayment of 915.
  const charged = await c.env.DB.prepare(`SELECT currency FROM payments WHERE id = ?`)
    .bind(reference)
    .first<{ currency: string }>();
  const paidMinor =
    state.amount === null ? null : toMinorUnits(state.amount, charged?.currency ?? 'XOF');
  if (state.status === 'pending') return c.json({ received: true, status: 'pending' });
  if (state.status === 'failed') {
    await c.env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'`)
      .bind(reference)
      .run();
    return c.json({ received: true, status: 'failed' });
  }

  const result = await fulfil(c.env, reference, paidMinor);
  return c.json({ received: true, ...result });
});

/** Where card rails send the customer back; the webhook is what settles it. */
checkout.get('/return/:orderId', (c) =>
  c.json({ orderId: c.req.param('orderId'), cancelled: c.req.query('cancelled') === '1' }),
);

export { fulfil };
export default checkout;
