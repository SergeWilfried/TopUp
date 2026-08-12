import { Hono } from 'hono';
import { deriveAgentToken } from './vpn/agent';
import {
  createDestination,
  createProduct,
  listDestinations,
  listProducts,
  setProductEnabled,
} from './catalogue';
import { translator } from './i18n';
import {
  commerceStats,
  customerDetail,
  getOrder,
  listCustomers,
  listOrders,
  type CustomerRow,
} from './commerce';
import {
  extendSubscription,
  getSubscription,
  installsByLocation,
  listSubscriptions,
  regenerateAll,
  statusOf,
  type SubscriptionRow,
} from './vpn/console';
import { ParamError, byNumber, byText, listQuery } from './query';
import type { Env } from './env';
import { currentUser, isStaff, type User } from './vpn/auth';

import { ANY_COUNTRY, isFeature, listFlags, setFlag } from './features';

const DAY = 86_400_000;
const admin = new Hono<{ Bindings: Env; Variables: { staff: User } }>();

/**
 * Staff gate.
 *
 * Everything under /admin was previously reachable by anyone who knew the URL:
 * every customer and order was readable, and creating a VPN endpoint writes an
 * agent token that controls the fleet. Sign in through the normal /auth/otp
 * flow; the account additionally needs is_staff.
 */
admin.use('/*', async (c, next) => {
  const user = await currentUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  // 403, not 404: the caller is authenticated, just not permitted.
  if (!isStaff(user)) return c.json({ error: 'forbidden' }, 403);
  c.set('staff', user);
  await next();
});

// Operational data changes under the operator's feet; a cached read would show
// them a stale console after they just changed something.
admin.use('/*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});

/** Query-parameter problems are the client's fault — report which one. */
admin.onError((err, c) => {
  if (err instanceof ParamError) return c.json({ error: err.code, field: err.field }, 400);
  throw err;
});

const params = (c: { req: { url: string } }) => new URL(c.req.url).searchParams;

/** Parses a `from`/`to` bound as epoch millis or an ISO date. */
const dateBound = (value: string, field: string) => {
  const n = Number(value);
  const ms = Number.isFinite(n) && value.trim() !== '' ? n : Date.parse(value);
  if (!Number.isFinite(ms)) throw new ParamError(field, `${field}_invalid`);
  return ms;
};

const numBound = (value: string, field: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ParamError(field, `${field}_invalid`);
  return n;
};

// ── dashboard ──────────────────────────────────────────────────────────────
admin.get('/stats', async (c) => {
  const vpn = await listSubscriptions(c.env);
  return c.json({
    ...(await commerceStats(c.env)),
    activeVpn: vpn.filter((s) => s.status !== 'lapsed').length,
    expiringVpn: vpn.filter((s) => s.status === 'expiring').length,
  });
});

// ── transactions (D1) ──────────────────────────────────────────────────────
// Filtering, sorting and pagination happen in SQL: orders is the table that
// grows, so loading it into memory to filter would not survive real volume.
admin.get('/orders', async (c) => c.json(await listOrders(c.env, params(c))));

admin.get('/orders/:id', async (c) => {
  const order = await getOrder(c.env, c.req.param('id'));
  return order ? c.json(order) : c.json({ error: 'not_found' }, 404);
});

// ── customers (D1) ─────────────────────────────────────────────────────────
// Small enough to filter in memory; revisit if the base grows past a few
// thousand, at which point this wants the same SQL treatment as orders.
admin.get('/customers', async (c) =>
  c.json(
    listQuery(await listCustomers(c.env), params(c), {
      search: (x) => [x.id, x.name, x.phone, x.carrier],
      filters: {
        carrier: (x, v) => x.carrier.toLowerCase() === v.toLowerCase(),
        minSpend: (x, v) => x.spend >= numBound(v, 'minSpend'),
        minOrders: (x, v) => x.orders >= numBound(v, 'minOrders'),
        joinedAfter: (x, v) => x.joinedAt >= dateBound(v, 'joinedAfter'),
      },
      sorts: {
        spend: byNumber<CustomerRow>((x) => x.spend),
        orders: byNumber<CustomerRow>((x) => x.orders),
        joined: byNumber<CustomerRow>((x) => x.joinedAt),
        points: byNumber<CustomerRow>((x) => x.points),
        name: byText<CustomerRow>((x) => x.name ?? ''),
      },
      defaultSort: 'spend',
      aggregate: (rows) => {
        const lifetimeValue = rows.reduce((sum, x) => sum + x.spend, 0);
        const repeatBuyers = rows.filter((x) => x.orders > 1).length;
        return {
          lifetimeValue,
          avgLifetime: rows.length ? Math.round(lifetimeValue / rows.length) : 0,
          repeatBuyers,
          repeatRate: rows.length ? Math.round((repeatBuyers / rows.length) * 100) : 0,
          pointsOutstanding: rows.reduce((sum, x) => sum + x.points, 0),
        };
      },
    }),
  ),
);

admin.get('/customers/:id', async (c) => {
  const detail = await customerDetail(c.env, c.req.param('id'));
  return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
});

// ── VPN subscriptions (D1) ─────────────────────────────────────────────────
admin.get('/subscriptions', async (c) => {
  const rows = await listSubscriptions(c.env);
  const result = listQuery<SubscriptionRow>(rows, params(c), {
    search: (s) => [s.id, s.email, s.plan],
    filters: {
      status: (s, v) => s.status === v,
      plan: (s, v) => s.plan.toLowerCase() === v.toLowerCase(),
      location: (s, v) => s.locations.includes(v.toUpperCase()),
      expiresBefore: (s, v) => s.expiresAt <= dateBound(v, 'expiresBefore'),
      expiresAfter: (s, v) => s.expiresAt >= dateBound(v, 'expiresAfter'),
    },
    sorts: {
      expires: byNumber<SubscriptionRow>((s) => s.expiresAt),
      started: byNumber<SubscriptionRow>((s) => s.startedAt ?? 0),
      locations: byNumber<SubscriptionRow>((s) => s.locations.length),
      email: byText<SubscriptionRow>((s) => s.email),
    },
    defaultSort: 'expires',
    defaultOrder: 'asc',
  });

  return c.json({
    ...result,
    counts: {
      active: rows.filter((s) => s.status === 'active').length,
      expiring: rows.filter((s) => s.status === 'expiring').length,
      lapsed: rows.filter((s) => s.status === 'lapsed').length,
      tunnels: rows.reduce((sum, s) => sum + s.devices, 0),
    },
    installsByLocation: await installsByLocation(c.env),
  });
});

admin.get('/subscriptions/:id', async (c) => {
  const sub = await getSubscription(c.env, c.req.param('id'));
  return sub ? c.json(sub) : c.json({ error: 'not_found' }, 404);
});

/**
 * Re-issues every tunnel on the account.
 *
 * Deliberately not called "resend": the config holds a private key minted on
 * the agent and given to the customer once, never stored. Support can only
 * create new keys, which breaks whatever is installed today.
 */
admin.post('/subscriptions/:id/regenerate', async (c) => {
  const result = await regenerateAll(c.env, c.req.param('id'));
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json(
    { to: result.email, reissued: result.issued.length, failed: result.failed },
    result.failed.length ? 207 : 200,
  );
});

admin.post('/subscriptions/:id/extend', async (c) => {
  const body = await c.req.json<{ days?: number }>().catch((): { days?: number } => ({}));
  const days = Number(body.days);
  if (!Number.isFinite(days) || days <= 0) return c.json({ error: 'days_required', field: 'days' }, 400);
  const updated = await extendSubscription(c.env, c.req.param('id'), days);
  return updated ? c.json(updated) : c.json({ error: 'not_found' }, 404);
});

// ── catalogue (D1) ─────────────────────────────────────────────────────────
// The console is English-only; the same rows render in French for customers
// because prose is stored as a translation key, not a resolved string.
admin.get('/products', async (c) => c.json(await listProducts(c.env, params(c), translator('en'))));

admin.post('/products', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await createProduct(c.env, body);
  return 'error' in result
    ? c.json({ error: result.error, field: result.field }, result.status)
    : c.json(result, 201);
});

admin.patch('/products/:id', async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>().catch((): { enabled?: boolean } => ({}));
  if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled_required', field: 'enabled' }, 400);
  const ok = await setProductEnabled(c.env, c.req.param('id'), body.enabled);
  return ok ? c.json({ id: c.req.param('id'), enabled: body.enabled }) : c.json({ error: 'not_found' }, 404);
});

// ── destinations (D1) ──────────────────────────────────────────────────────
// Kept on the shared envelope so it filters, sorts and reports `total` like
// every other collection.
type DestinationRow = Awaited<ReturnType<typeof listDestinations>>[number];

admin.get('/destinations', async (c) =>
  c.json(
    listQuery<DestinationRow>(await listDestinations(c.env, translator('en')), params(c), {
      search: (d) => [d.name, d.code, d.sub],
      filters: {
        type: (d, v) => d.type === v,
        code: (d, v) => d.code.toUpperCase() === v.toUpperCase(),
        active: (d, v) => String(d.active) === v,
      },
      sorts: {
        name: byText<DestinationRow>((d) => d.name),
        plans: byNumber<DestinationRow>((d) => d.plans),
        sold: byNumber<DestinationRow>((d) => d.sold),
      },
      defaultSort: 'name',
      defaultOrder: 'asc',
      defaultPerPage: 50,
    }),
  ),
);

admin.post('/destinations', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await createDestination(c.env, body);
  return 'error' in result
    ? c.json({ error: result.error, field: result.field }, result.status)
    : c.json(result, 201);
});

// ── endpoints (D1 `servers`) ───────────────────────────────────────────────
type EndpointRow = {
  code: string;
  name: string;
  host: string;
  api_url: string;
  active: number;
  installs: number;
};

admin.get('/endpoints', async (c) => {
  // agent_token is never returned: the console has no use for it and it would
  // sit in a browser's memory and network log.
  const { results } = await c.env.DB.prepare(
    `SELECT s.id AS code, s.name, s.host, s.api_url, s.active,
            COUNT(p.public_key) AS installs
     FROM servers s
     LEFT JOIN peers p ON p.server_id = s.id AND p.state = 'active'
     GROUP BY s.id`,
  ).all<EndpointRow>();

  return c.json(
    listQuery<EndpointRow>(results, params(c), {
      search: (e) => [e.name, e.code, e.host],
      filters: {
        code: (e, v) => e.code.toUpperCase() === v.toUpperCase(),
        active: (e, v) => String(Boolean(e.active)) === v,
        minInstalls: (e, v) => e.installs >= numBound(v, 'minInstalls'),
      },
      sorts: {
        installs: byNumber<EndpointRow>((e) => e.installs),
        name: byText<EndpointRow>((e) => e.name),
      },
      defaultSort: 'installs',
      defaultPerPage: 50,
    }),
  );
});

admin.post('/endpoints', async (c) => {
  type Body = { name?: string; code?: string; host?: string; apiUrl?: string };
  const b = await c.req.json<Body>().catch((): Body => ({}));
  const name = (b.name ?? '').trim();
  const code = (b.code ?? '').trim().toUpperCase();
  const host = (b.host ?? '').trim().toLowerCase();
  const apiUrl = (b.apiUrl ?? '').trim();

  const HOSTNAME = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
  if (name.length < 2) return c.json({ error: 'name_required', field: 'name' }, 400);
  if (!/^[A-Z]{2}$/.test(code)) return c.json({ error: 'code_invalid', field: 'code' }, 400);
  if (!HOSTNAME.test(host)) return c.json({ error: 'host_invalid', field: 'host' }, 400);
  // The agent must be reachable over TLS: the bearer token grants peer management.
  if (!/^https:\/\/[^\s]+$/.test(apiUrl) && c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'api_url_invalid', field: 'apiUrl' }, 400);
  }
  if (!c.env.AGENT_SIGNING_KEY) return c.json({ error: 'agent_signing_key_missing' }, 503);

  const exists = await c.env.DB.prepare(`SELECT 1 FROM servers WHERE id = ?`).bind(code).first();
  if (exists) return c.json({ error: 'code_taken', field: 'code' }, 409);

  await c.env.DB.prepare(
    `INSERT INTO servers (id, name, host, api_url, active) VALUES (?, ?, ?, ?, 1)`,
  )
    .bind(code, name, host, apiUrl)
    .run();

  // The operator needs the token to run the installer on the box. It is derived,
  // not stored, so this is a convenience rather than a one-time reveal — the
  // dedicated endpoint below returns the same value on demand.
  // Existing subscribers are not migrated — they install a new location when
  // they choose to, which is what the app's setup step already assumes.
  return c.json(
    {
      code,
      name,
      host,
      api_url: apiUrl,
      active: 1,
      installs: 0,
      agentToken: await deriveAgentToken(c.env, code),
    },
    201,
  );
});

/**
 * Reveals the derived agent token for one endpoint.
 *
 * Split from the list so the credential is never bulk-fetched into a browser
 * alongside routine data, and so the read is individually attributable.
 */
admin.get('/endpoints/:code/token', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const row = await c.env.DB.prepare(`SELECT id FROM servers WHERE id = ?`).bind(code).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!c.env.AGENT_SIGNING_KEY) return c.json({ error: 'agent_signing_key_missing' }, 503);

  const staff = c.get('staff');
  console.log(`[audit] agent token for ${code} revealed to ${staff?.email ?? staff?.id ?? '?'}`);
  return c.json({ code, agentToken: await deriveAgentToken(c.env, code) });
});

/**
 * Pulls the distributor's live data bundles into the catalogue.
 *
 * Safe to run repeatedly: bundles are upserted by id and ones that vanish are
 * disabled rather than deleted, so order history keeps resolving.
 */
admin.post('/bundles/sync', async (c) => {
  const { syncDataBundles } = await import('./delivery/bundles');
  const country = (c.req.query('country') ?? 'BF').toUpperCase();
  const name = c.req.query('name') ?? 'Burkina Faso';
  return c.json(await syncDataBundles(c.env, country, name));
});

/**
 * Remaining airtime float at the distributor, per country.
 *
 * Airtime distribution fails first by running out of money rather than by
 * breaking, so this is the number worth alerting on. Returns 503 rather than an
 * empty list when the credentials are missing, so "not configured" cannot be
 * mistaken for "nothing left".
 */
admin.get('/float', async (c) => {
  const { checkBalance } = await import('./delivery');
  const result = await checkBalance(c.env);
  return result.ok
    ? c.json({ balances: result.balances })
    : c.json({ error: result.error }, result.error === 'not_configured' ? 503 : 502);
});

/**
 * Drives the delivery state machine with fake providers. Development only.
 *
 * Exists because the one property that matters here — an ambiguous outcome is
 * never retried — cannot be observed from a provider that always succeeds.
 */
admin.post('/dev/deliver/:orderId', async (c) => {
  if (c.env.ENVIRONMENT === 'production') return c.json({ error: 'not_available' }, 403);
  const { registerTestProviders } = await import('./delivery/testkit');
  const { deliverOrder } = await import('./delivery');
  registerTestProviders();
  await deliverOrder(c.env, c.req.param('orderId'));
  const order = await c.env.DB.prepare(
    `SELECT id, status, delivery_provider, delivery_ref, delivery_error, delivery_attempts
     FROM orders WHERE id = ?`,
  )
    .bind(c.req.param('orderId'))
    .first();
  return c.json(order ?? { error: 'not_found' });
});

admin.post('/dev/reconcile', async (c) => {
  if (c.env.ENVIRONMENT === 'production') return c.json({ error: 'not_available' }, 403);
  const { registerTestProviders } = await import('./delivery/testkit');
  const { reconcileDeliveries } = await import('./delivery');
  registerTestProviders();
  return c.json({ resolved: await reconcileDeliveries(c.env) });
});

/** Loads fixtures into D1. Refuses to run against production. */
admin.post('/dev/seed', async (c) => {
  if (c.env.ENVIRONMENT === 'production') return c.json({ error: 'not_available' }, 403);
  const { seedCatalogue, seedCommerce } = await import('./store');
  const { seedRates } = await import('./checkout/pricing');
  await seedRates(c.env);
  // Catalogue first: orders reference product ids.
  const catalogue = await seedCatalogue(c.env);
  const commerce = await seedCommerce(c.env);
  return c.json({ ...catalogue, ...commerce });
});

export default admin;

// ── feature flags ──────────────────────────────────────────────────────────

/** Every switch, its default, and the overrides currently in force. */
admin.get('/features', async (c) => c.json(await listFlags(c.env)));

/**
 * Flips one feature in one market.
 *
 * `enabled: null` removes the override so the market follows the default again.
 * The feature name is checked against the catalogue in code: accepting an
 * arbitrary string would store a switch that reads convincingly in the console
 * and controls nothing.
 */
admin.put('/features/:feature/:country', async (c) => {
  const feature = c.req.param('feature');
  if (!isFeature(feature)) return c.json({ error: 'unknown_feature', field: 'feature' }, 400);

  const raw = c.req.param('country');
  const country = raw === ANY_COUNTRY ? ANY_COUNTRY : raw.toUpperCase();
  if (country !== ANY_COUNTRY && !/^[A-Z]{2}$/.test(country)) {
    return c.json({ error: 'bad_country', field: 'country' }, 400);
  }

  type FlagBody = { enabled?: boolean | null; note?: string };
  const body = await c.req.json<FlagBody>().catch((): FlagBody => ({}));
  if (body.enabled !== null && typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled_required', field: 'enabled' }, 400);
  }

  await setFlag(c.env, feature, country, body.enabled ?? null, body.note);
  console.log(`[flags] ${feature}/${country} -> ${body.enabled} by ${c.get('staff').id}`);
  return c.json(await listFlags(c.env));
});
