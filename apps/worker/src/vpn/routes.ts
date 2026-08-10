import { Hono } from 'hono';
import { isEmail, type Env } from '../env';
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
const identify = (body: { email?: string; msisdn?: string } | null) => {
  if (body?.msisdn) {
    const msisdn = normaliseMsisdn(body.msisdn);
    return msisdn.length >= 8
      ? ({ identifier: msisdn, channel: 'sms' as Channel } as const)
      : ({ error: 'msisdn_invalid', field: 'msisdn' } as const);
  }
  if (isEmail(body?.email)) {
    return { identifier: body!.email!.toLowerCase(), channel: 'email' as Channel } as const;
  }
  return { error: 'identifier_required', field: 'email' } as const;
};

vpn.post('/auth/otp', async (c) => {
  const body = await c.req.json<{ email?: string; msisdn?: string }>().catch(() => null);
  const id = identify(body);
  if ('error' in id) return c.json({ error: id.error, field: id.field }, 400);

  const result = await requestOtp(c.env, id.identifier, id.channel);
  if (!result.ok) return c.json({ error: result.error }, result.status as 429);
  await sendOtp(c.env, id.identifier, result.code!, id.channel);
  // Same response either way: whether the identifier has an account is not leaked.
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
