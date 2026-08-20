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
import { now, randHex, sha256, type Env } from './env';
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
/** Pulls Yesim's plans for the curated destinations into the catalogue. */
admin.post('/esim/sync', async (c) => {
  const { syncEsimPlans } = await import('./delivery/esim-plans');
  return c.json(await syncEsimPlans(c.env));
});

/** Pulls Yesim's list of handsets it will install onto. */
admin.post('/esim/devices/sync', async (c) => {
  const { syncEsimDevices } = await import('./delivery/esim-devices');
  return c.json(await syncEsimDevices(c.env));
});

/**
 * What the installed base is holding, and how much of it can take an eSIM.
 *
 * The one number that says whether an eSIM corridor is a market or a rounding
 * error. `unmatched` is the work queue: handsets seen often that the provider
 * does not list, each of which is either genuinely incapable or a spelling we
 * failed to match — reading them is the only way to tell.
 */
admin.get('/devices', async (c) => {
  const { deviceBreakdown } = await import('./delivery/esim-devices');
  return c.json(await deviceBreakdown(c.env));
});

admin.post('/bundles/sync', async (c) => {
  const { syncDataBundles } = await import('./delivery/bundles');
  const country = (c.req.query('country') ?? 'BF').toUpperCase();
  const name = c.req.query('name') ?? 'Burkina Faso';
  return c.json(await syncDataBundles(c.env, country, name));
});

// ── phone farm ──────────────────────────────────────────────────────────────

/** Every SIM in the farm, with what it is holding and when it last spoke. */
admin.get('/agents', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.label, a.msisdn, a.carrier, a.country, a.active, a.float_balance AS floatBalance,
            a.daily_cap AS dailyCap, a.daily_count AS dailyCount, a.last_seen AS lastSeen,
            (SELECT COUNT(*) FROM delivery_jobs j WHERE j.agent_id = a.id AND j.status = 'leased') AS inFlight
     FROM agents a ORDER BY a.country, a.carrier, a.created_at`,
  ).all();

  const queue = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN status = 'leased' THEN 1 ELSE 0 END) AS leased,
            SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
     FROM delivery_jobs`,
  ).first();

  /**
   * Routes, and whether each one can actually dispatch.
   *
   * A SIM enrolled for a market with no published menu is a device that will
   * poll forever and never send anything — `/agent/script` 404s and the loop
   * declines the work. That is invisible from the agent list alone, so the
   * pairing is computed here: every route someone enrolled a SIM for, against
   * the script that route does or does not have.
   */
  const { results: routes } = await c.env.DB.prepare(
    `SELECT a.country, a.carrier, COUNT(*) AS agents,
            SUM(CASE WHEN a.active = 1 THEN 1 ELSE 0 END) AS activeAgents,
            s.version AS scriptVersion
     FROM agents a
     LEFT JOIN ussd_scripts s ON s.country = a.country AND s.carrier = a.carrier
     GROUP BY a.country, a.carrier
     ORDER BY a.country, a.carrier`,
  ).all();

  return c.json({ agents: results, queue, routes });
});

/**
 * One SIM, with what it has actually been doing.
 *
 * The fleet list answers "is anything wrong"; this answers "wrong how". A SIM
 * that stopped dispatching looks identical from the outside whether it ran out
 * of float, hit its cap, lost its script, or has been failing every job for an
 * hour — and only the last of those is urgent.
 */
admin.get('/agents/:id', async (c) => {
  const agent = await c.env.DB.prepare(
    `SELECT a.id, a.label, a.msisdn, a.carrier, a.country, a.active,
            a.float_balance AS floatBalance, a.daily_cap AS dailyCap, a.daily_count AS dailyCount,
            a.daily_reset_at AS dailyResetAt, a.last_seen AS lastSeen, a.created_at AS createdAt,
            s.version AS scriptVersion
     FROM agents a
     LEFT JOIN ussd_scripts s ON s.country = a.country AND s.carrier = a.carrier
     WHERE a.id = ?`,
  )
    .bind(c.req.param('id'))
    .first();
  if (!agent) return c.json({ error: 'not_found' }, 404);

  const { results: jobs } = await c.env.DB.prepare(
    `SELECT id, order_id AS orderId, msisdn, amount, status, failure_reason AS failureReason,
            provider_ref AS providerRef, created_at AS createdAt, updated_at AS updatedAt
     FROM delivery_jobs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(c.req.param('id'))
    .all();

  const tally = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
     FROM delivery_jobs WHERE agent_id = ?`,
  )
    .bind(c.req.param('id'))
    .first();

  return c.json({ agent, jobs, tally });
});

/**
 * Enrols a SIM and returns its token once.
 *
 * The token is shown here and never again — only its hash is stored, the same
 * as a session. Losing it means enrolling the device again, which is the
 * correct trade for a credential that can spend your float.
 */
admin.post('/agents', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    msisdn?: string; carrier?: string; country?: string; label?: string; dailyCap?: number;
  };
  const msisdn = String(body.msisdn ?? '').replace(/\D/g, '');
  const carrier = String(body.carrier ?? '').trim();
  const country = String(body.country ?? '').trim().toUpperCase();
  if (!msisdn || !carrier || country.length !== 2) {
    return c.json({ error: 'msisdn_carrier_and_country_required' }, 400);
  }

  const token = `agt_${randHex(24)}`;
  const id = `agent_${randHex(6)}`;
  try {
    await c.env.DB.prepare(
      `INSERT INTO agents (id, label, msisdn, carrier, country, token_hash, daily_cap, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, body.label ?? null, msisdn, carrier, country,
            await sha256(token), Number.isFinite(body.dailyCap) ? Number(body.dailyCap) : null, now())
      .run();
  } catch {
    return c.json({ error: 'msisdn_already_enrolled' }, 409);
  }

  const staff = c.get('staff');
  console.log(`[audit] agent ${id} (${carrier}/${country}) enrolled by ${staff?.email ?? staff?.id}`);
  return c.json({ id, token }, 201);
});

/** Retires a SIM. Jobs it already holds run their course or expire to unknown. */
admin.post('/agents/:id/disable', async (c) => {
  const res = await c.env.DB.prepare(`UPDATE agents SET active = 0 WHERE id = ?`)
    .bind(c.req.param('id'))
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404);
  const staff = c.get('staff');
  console.log(`[audit] agent ${c.req.param('id')} disabled by ${staff?.email ?? staff?.id}`);
  return c.json({ ok: true });
});

/** The USSD menus, one row per market and operator. */
admin.get('/scripts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT country, carrier, version, entry, steps, success_re AS successRe, updated_at AS updatedAt
     FROM ussd_scripts ORDER BY country, carrier`,
  ).all();
  return c.json({ scripts: results });
});

/**
 * Publishes a menu for one route, bumping its version.
 *
 * Validated here rather than on the handset: a device that fetches a broken
 * script types garbage into a live menu holding real money, so the parse has
 * to fail on this side of the wire.
 */
admin.put('/scripts/:country/:carrier', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    entry?: unknown; steps?: unknown; successRe?: unknown;
  };
  const entry = String(body.entry ?? '').trim();
  if (!entry.startsWith('*') || !entry.endsWith('#')) {
    return c.json({ error: 'entry_must_be_a_ussd_string', field: 'entry' }, 400);
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: 'steps_required', field: 'steps' }, 400);
  }
  for (const [i, step] of body.steps.entries()) {
    const st = step as { expect?: unknown; send?: unknown };
    if (typeof st.expect !== 'string' || typeof st.send !== 'string') {
      return c.json({ error: `step_${i}_needs_expect_and_send`, field: 'steps' }, 400);
    }
    try {
      new RegExp(st.expect);
    } catch {
      return c.json({ error: `step_${i}_expect_is_not_a_regex`, field: 'steps' }, 400);
    }
  }

  const country = c.req.param('country').toUpperCase();
  const carrier = c.req.param('carrier');
  await c.env.DB.prepare(
    `INSERT INTO ussd_scripts (country, carrier, version, entry, steps, success_re, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(country, carrier) DO UPDATE SET
       version = ussd_scripts.version + 1,
       entry = excluded.entry, steps = excluded.steps,
       success_re = excluded.success_re, updated_at = excluded.updated_at`,
  )
    .bind(country, carrier, entry, JSON.stringify(body.steps), body.successRe ?? null, now())
    .run();

  const row = await c.env.DB.prepare(
    `SELECT version FROM ussd_scripts WHERE country = ? AND carrier = ?`,
  )
    .bind(country, carrier)
    .first<{ version: number }>();
  const staff = c.get('staff');
  console.log(`[audit] ussd script ${country}/${carrier} v${row?.version} published by ${staff?.email ?? staff?.id}`);
  return c.json({ country, carrier, version: row?.version ?? 1 });
});

// ── order actions ───────────────────────────────────────────────────────────

/**
 * Asks the provider what became of one order, on demand.
 *
 * The reconciliation sweep does this on its own schedule; the operator looking
 * at a stuck order in the console wants the answer now. It only ever *asks* —
 * an ambiguous top-up that gets re-sent is one the customer may receive twice
 * and we pay for twice, so there is no retry here and there should never be.
 */
admin.post('/orders/:id/recheck', async (c) => {
  const { recheckOrder } = await import('./delivery');
  const result = await recheckOrder(c.env, c.req.param('id'));
  const staff = c.get('staff');
  console.log(`[audit] recheck ${result.orderId} → ${result.status} by ${staff?.email ?? staff?.id}`);
  return c.json(result, result.status === 'not_checkable' && result.reason === 'not_found' ? 404 : 200);
});

/**
 * Closes an order that was never paid for.
 *
 * Refused outright if any payment on it was captured, so this can only ever
 * clear rows where no money moved.
 */
admin.post('/orders/:id/expire', async (c) => {
  const { expireOrder } = await import('./commerce');
  const result = await expireOrder(c.env, c.req.param('id'));
  const staff = c.get('staff');
  if (!result.ok) {
    return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 409);
  }
  console.log(`[audit] expired ${c.req.param('id')} by ${staff?.email ?? staff?.id}`);
  return c.json({ ok: true, id: c.req.param('id') });
});

// ── team & security ─────────────────────────────────────────────────────────

/** Who has console access, and whether they have ever managed to use it. */
admin.get('/team', async (c) => {
  const { listStaff } = await import('./staff');
  return c.json(await listStaff(c.env, c.get('staff').id));
});

/**
 * Grants access to an email address, creating the account if it is new.
 *
 * The invitee then signs in through the ordinary OTP flow and is already
 * staff. Creating the row up front is the whole point: the alternative asks
 * them to sign in first so you can promote them afterwards, which is
 * impossible to bootstrap and is why the first staff account here had to be
 * written by hand against production.
 */
admin.post('/team', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const { grantStaff } = await import('./staff');
  const result = await grantStaff(c.env, body.email);
  if (!result.ok) return c.json({ error: result.error, field: 'email' }, result.status as 400);

  const staff = c.get('staff');
  console.log(`[audit] staff granted to ${String(body.email)} by ${staff?.email ?? staff?.id}`);
  return c.json(result.data, 201);
});

/** Removes access and ends that account's sessions. Cannot lock you out. */
admin.delete('/team/:id', async (c) => {
  const { revokeStaff } = await import('./staff');
  const staff = c.get('staff');
  const result = await revokeStaff(c.env, c.req.param('id'), staff.id);
  if (!result.ok) return c.json({ error: result.error }, result.status as 404);

  console.log(`[audit] staff revoked from ${c.req.param('id')} by ${staff?.email ?? staff?.id}`);
  return c.json(result.data);
});

/** Signs one account out everywhere without changing what it may do. */
admin.post('/team/:id/signout', async (c) => {
  const { revokeSessions } = await import('./staff');
  const staff = c.get('staff');
  const result = await revokeSessions(c.env, c.req.param('id'));
  console.log(`[audit] sessions revoked for ${c.req.param('id')} by ${staff?.email ?? staff?.id}`);
  return c.json(result);
});

/**
 * Whether the front door works. Booleans only — never a secret's value.
 *
 * Production had no OTP channel configured at all, so the one staff account
 * that existed could not sign in, and nothing in the console said why.
 */
admin.get('/security', async (c) => {
  const { securityState } = await import('./staff');
  return c.json(await securityState(c.env));
});

/**
 * The FX rate book.
 *
 * Lists every currency the payment router can land on, not merely the ones a
 * row exists for: a missing rate is the interesting case, and an absent row
 * shows nothing. While a rate is missing, that market's checkout returns
 * `no_fx_rate` and the customer simply cannot pay.
 */
admin.get('/rates', async (c) => {
  const { listRates } = await import('./checkout/rates');
  return c.json(await listRates(c.env));
});

/**
 * Sets one rate, quoted as an operator says it: "1 USD = 610 FCFA".
 *
 * One at a time and typed by a person on purpose. There is no bulk seed here
 * because filling the table with indicative numbers would convert an honest
 * refusal into a quietly wrong price, and a wrong rate loses money on every
 * sale without anyone noticing.
 */
admin.put('/rates/:currency', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { xofPerUnit?: unknown };
  const { setRate } = await import('./checkout/rates');
  const result = await setRate(c.env, c.req.param('currency'), body.xofPerUnit);
  if (!result.ok) return c.json({ error: result.error, field: 'xofPerUnit' }, result.status as 400);

  const staff = c.get('staff');
  console.log(`[audit] fx rate ${result.row.currency} set by ${staff?.email ?? staff?.id ?? '?'}`);
  return c.json(result.row);
});

/**
 * Prepaid balance on every delivery rail, in one call.
 *
 * Both rails are prepaid, so this is the pair of numbers that decides whether
 * tomorrow's orders can be delivered at all. Always 200: a rail that is down or
 * unconfigured says so in its own row rather than blanking the panel, because
 * an operator needs to know *which* rail is dry.
 */
admin.get('/balances', async (c) => {
  const { providerBalances } = await import('./delivery/balances');
  return c.json(await providerBalances(c.env));
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
