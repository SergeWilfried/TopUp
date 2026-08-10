import { Hono } from 'hono';
import { isEmail, type Env } from '../env';
import { translator } from '../i18n';
import {
  currentUser,
  isActive,
  isStaff,
  normaliseMsisdn,
  requestOtp,
  sendOtp,
  signOut,
  verifyOtp,
  type Channel,
  type User,
} from './auth';
import { handleStripeEvent, verifySignature } from './billing';
import { isError, listPeers, provision, regenerate, removePeer } from './peers';

/**
 * VPN control plane: passwordless auth, subscription state and peer lifecycle.
 *
 * Merged into this Worker rather than deployed separately — a second Worker
 * meant two sources of truth for locations and two implementations of the same
 * renewal rule. Everything here is backed by D1; the catalogue and the admin
 * console's transaction fixtures are still in-memory.
 */
const vpn = new Hono<{ Bindings: Env; Variables: { user: User } }>();

// Sessions and subscription state must never come from a cache.
vpn.use('/*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});

// ── auth ────────────────────────────────────────────────────────────────────
/**
 * Resolves the identifier the caller signed in with. The app sends a phone
 * number, the console and VPN recovery send an email; both land on one account.
 */
const identify = (body: { email?: string; msisdn?: string; country?: string } | null) => {
  if (body?.msisdn) {
    // Identity is the canonical E.164 form, so the same handset resolves to one
    // account whether the customer typed a national number, a trunk zero or a
    // full international prefix.
    const msisdn = normaliseMsisdn(body.msisdn, body.country);
    return msisdn
      ? ({ identifier: msisdn, channel: 'sms' as Channel } as const)
      : ({ error: 'msisdn_invalid', field: 'msisdn' } as const);
  }
  if (isEmail(body?.email)) {
    return { identifier: body!.email!.toLowerCase(), channel: 'email' as Channel } as const;
  }
  return { error: 'identifier_required', field: 'email' } as const;
};

vpn.post('/auth/otp', async (c) => {
  const body = await c.req
    .json<{ email?: string; msisdn?: string; country?: string }>()
    .catch(() => null);
  const id = identify(body);
  if ('error' in id) return c.json({ error: id.error, field: id.field }, 400);

  const result = await requestOtp(c.env, id.identifier, id.channel);
  if (!result.ok) return c.json({ error: result.error }, result.status as 429);

  // The stored identifier is a national number; the raw input and the country
  // the client stated are what let the SMS reach the right handset.
  const delivery = await sendOtp(c.env, id.identifier, result.code!, id.channel, {
    raw: body?.msisdn,
    country: body?.country ?? null,
  });

  // A delivery failure is reported. It reveals nothing about whether the
  // account exists — a code row is written either way — and the alternative is
  // sending the customer to a code screen no code will ever arrive at.
  if (!delivery.ok) return c.json({ error: 'delivery_failed', reason: delivery.error }, 502);

  // Success says nothing about whether the identifier is known to us.
  return c.json({ sent: true, channel: id.channel });
});

vpn.post('/auth/verify', async (c) => {
  const body = await c.req.json<{ email?: string; msisdn?: string; code?: string }>().catch(() => null);
  const id = identify(body);
  if ('error' in id) return c.json({ error: id.error, field: id.field }, 400);
  if (typeof body?.code !== 'string') return c.json({ error: 'code_required', field: 'code' }, 400);

  const result = await verifyOtp(c.env, id.identifier, body.code, id.channel);
  if (!result.ok) return c.json({ error: result.error }, result.status as 401);

  // The client needs to know whether to offer the console.
  return c.json({
    token: result.token,
    user: {
      id: result.user.id,
      email: result.user.email,
      msisdn: result.user.msisdn,
      isStaff: isStaff(result.user),
    },
  });
});

// ── payments ────────────────────────────────────────────────────────────────
vpn.post('/webhook/stripe', async (c) => {
  const raw = await c.req.text();
  const ok = await verifySignature(
    c.req.header('stripe-signature') ?? null,
    raw,
    c.env.STRIPE_WEBHOOK_SECRET,
  );
  if (!ok) return c.json({ error: 'bad_signature' }, 400);

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: 'malformed_event' }, 400);
  }
  const outcome = await handleStripeEvent(c.env, event as never);
  return c.json(outcome.body, outcome.status as 200);
});

// ── everything below needs a session ────────────────────────────────────────
vpn.use('/me/*', async (c, next) => {
  const user = await currentUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

vpn.post('/auth/signout', async (c) => {
  await signOut(c.req.raw, c.env);
  return c.json({ ok: true });
});

vpn.get('/me', async (c) => {
  const user = await currentUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const { results: peers } = await listPeers(c.env, user.id);
  return c.json({
    id: user.id,
    email: user.email,
    msisdn: user.msisdn,
    isStaff: isStaff(user),
    subscriptionActive: isActive(user),
    subExpiresAt: user.sub_expires_at,
    deviceLimit: Number(c.env.DEVICE_LIMIT ?? 3),
    peers,
  });
});

/**
 * The signed-in customer's purchases and loyalty balance.
 *
 * Orders are keyed by MSISDN through `customers`, which the checkout writes in
 * the same normalised form the auth layer stores — that link is the only thing
 * connecting a phone sign-in to the purchases made from it. Card-rail orders
 * are filed under `email:<address>`, so both keys are matched.
 */
vpn.get('/me/orders', async (c) => {
  const user = c.get('user');
  const keys = [user.msisdn, user.email && `email:${user.email}`].filter(Boolean) as string[];
  if (!keys.length) return c.json({ points: 0, orders: [] });

  const placeholders = keys.map(() => '?').join(', ');
  const customer = await c.env.DB.prepare(
    `SELECT id, points FROM customers WHERE msisdn IN (${placeholders})`,
  )
    .bind(...keys)
    .first<{ id: string; points: number }>();
  if (!customer) return c.json({ points: 0, orders: [] });

  // `detail` is the English snapshot taken at purchase time, so a French
  // customer's history read "5 GB · Valid 30 days" under French chrome. The
  // product's translation key is resolved per request instead, with the
  // snapshot as the fallback for rows whose product has since been deleted.
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.product, o.sku, o.detail, o.amount, o.currency, o.status,
            o.created_at AS createdAt, o.delivered_at AS deliveredAt,
            o.failure_reason AS failureReason, o.recipient_msisdn AS recipientMsisdn,
            p.name_key AS nameKey, p.name AS productName,
            p.terms_key AS termsKey, p.terms AS terms, p.terms_params AS termsParams
     FROM orders o
     LEFT JOIN products p ON p.id = o.sku
     WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 50`,
  )
    .bind(customer.id)
    .all<{
      detail: string;
      nameKey: string | null;
      productName: string | null;
      termsKey: string | null;
      terms: string | null;
      termsParams: string | null;
    }>();

  const t = translator(c.req.query('lang') ?? 'en');
  const orders = results.map(({ nameKey, productName, termsKey, terms, termsParams, ...row }) => {
    const name = nameKey ? t(nameKey) : productName;
    if (!name) return { ...row };
    // "5 GB · Valid 30 days" rather than a bare "5 GB": the validity is what
    // distinguishes two otherwise identical lines in a list of past purchases.
    let params: Record<string, string | number> | undefined;
    try {
      params = termsParams ? JSON.parse(termsParams) : undefined;
    } catch {
      params = undefined;
    }
    const suffix = termsKey ? t(termsKey, params) : terms;
    return { ...row, detail: suffix ? `${name} · ${suffix}` : name };
  });

  return c.json({ points: customer.points, orders });
});

vpn.post('/me/provision', async (c) => {
  const user = c.get('user');
  if (!isActive(user)) return c.json({ error: 'subscription_inactive' }, 402);
  const body = await c.req.json<{ serverId?: unknown }>().catch(() => null);
  const result = await provision(c.env, user, body?.serverId);
  return isError(result) ? c.json({ error: result.error }, result.status as 400) : c.json(result, 201);
});

vpn.post('/me/regenerate', async (c) => {
  const user = c.get('user');
  if (!isActive(user)) return c.json({ error: 'subscription_inactive' }, 402);
  const body = await c.req.json<{ publicKey?: unknown }>().catch(() => null);
  const result = await regenerate(c.env, user, body?.publicKey);
  return isError(result) ? c.json({ error: result.error }, result.status as 400) : c.json(result, 201);
});

vpn.delete('/me/peers/:publicKey', async (c) => {
  const failure = await removePeer(c.env, c.get('user'), c.req.param('publicKey'));
  return failure ? c.json({ error: failure.error }, failure.status as 404) : c.json({ ok: true });
});

export default vpn;
