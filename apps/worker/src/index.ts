import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicCatalogue, esimPlansForCountry } from './catalogue';
import { translator } from './i18n';
import admin from './admin';
import checkout from './checkout/routes';
import agent from './agent';
import vpn from './vpn/routes';
import { sweep } from './vpn/sweep';
import { reconcileDeliveries } from './delivery';
import { featuresFor } from './features';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors());

const langOf = (c: { req: { query: (k: string) => string | undefined } }) => c.req.query('lang') ?? 'en';

app.get('/health', (c) => c.json({ ok: true, service: 'topup-api' }));

// Served from the `products` table. Prose is stored as a translation key, so
// the same rows answer in either language.
app.get('/catalogue', async (c) => c.json(await publicCatalogue(c.env, translator(langOf(c)))));

app.get('/esim/plans/:country', async (c) => {
  const country = decodeURIComponent(c.req.param('country'));
  return c.json({ country, plans: await esimPlansForCountry(c.env, country, translator(langOf(c))) });
});

// What is switched on in a given market. The app asks before drawing the home
// screen so it never offers a service the backend would refuse.
app.get('/features', async (c) => {
  const country = (c.req.query('country') ?? '').toUpperCase();
  return c.json({ country, features: await featuresFor(c.env, country) });
});

/**
 * One line about the handset, reported once per install at boot.
 *
 * eSIM is the only thing we sell that the customer's own hardware can refuse,
 * and until this existed there was no way to know how much of the base can
 * take one — the provider publishes which models work, never how many of ours
 * are those models. The answer decides whether an eSIM corridor is worth
 * building at all, so it is worth one request per install.
 *
 * Unauthenticated, because boot happens before sign-in, and carrying no
 * identity on purpose: an install id the app generates for itself, a brand and
 * a model. Fields are clipped rather than rejected — a report is worth less
 * than a launch, and must never be what fails one.
 */
app.post('/telemetry/device', async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const clip = (v: unknown, n: number) => {
    const s = typeof v === 'string' ? v.trim().slice(0, n) : '';
    return s || null;
  };
  const installId = clip(body.installId, 64);
  if (!installId) return c.json({ error: 'install_id_required' }, 400);

  const brand = clip(body.brand, 40);
  const model = clip(body.model, 80);
  const { normalizeModel, lookup } = await import('./delivery/esim-devices');
  const { verdict } = await lookup(c.env, brand, model);

  await c.env.DB.prepare(
    `INSERT INTO device_seen (install_id, brand, model, model_norm, os_name, os_version, country,
                              esim_capable, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET
       brand = excluded.brand, model = excluded.model, model_norm = excluded.model_norm,
       os_name = excluded.os_name, os_version = excluded.os_version,
       country = COALESCE(excluded.country, device_seen.country),
       esim_capable = excluded.esim_capable,
       last_seen = excluded.last_seen`,
  )
    .bind(
      installId,
      brand,
      model,
      normalizeModel(model) || null,
      clip(body.osName, 20),
      clip(body.osVersion, 20),
      (clip(body.country, 2) ?? '').toUpperCase() || null,
      verdict === 'supported' ? 1 : null,
      Date.now(),
      Date.now(),
    )
    .run();

  // Answered in the same round trip the report costs, so the eSIM screens can
  // say something useful about this handset without a second call.
  return c.json({ esim: verdict });
});

// Everything under /admin backs the console: dashboard, transactions,
// customers, subscriptions and catalogue management.
app.route('/admin', admin);

// Customer purchases: order + payment, provider handoff, callbacks.
app.route('/checkout', checkout);

// The phone farm polls here for airtime to dispatch over USSD.
app.route('/agent', agent);

// Customer-facing VPN control plane — auth, subscription, peers. D1-backed.
app.route('/', vpn);

// Locations come from the `servers` table, which also holds the agent URL.
// That column is never exposed here. `host` is: it is the tunnel endpoint,
// written into every config the customer installs, so it is not a secret.
app.get('/servers', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id AS code, name, host FROM servers WHERE active = 1 ORDER BY name`,
  ).all();
  return c.json({ servers: results });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,

  /**
   * Expiry sweep, peer reconciliation, and delivery reconciliation.
   *
   * The delivery pass only ever *asks* a provider what happened — it never
   * re-sends. An ambiguous top-up that is retried is one the customer may
   * receive twice and we pay for twice, so anything still unresolved stays put
   * for a human rather than being guessed at on a schedule.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env).catch((e) => console.error(`sweep failed: ${(e as Error).message}`)));
    ctx.waitUntil(
      reconcileDeliveries(env).catch((e) =>
        console.error(`delivery reconciliation failed: ${(e as Error).message}`),
      ),
    );
    // Operators reprice and retire bundles without notice, so the catalogue is
    // refreshed from them rather than maintained by hand.
    ctx.waitUntil(
      import('./delivery/bundles')
        .then(({ syncDataBundles }) => syncDataBundles(env, 'BF', 'Burkina Faso'))
        .catch((e) => console.error(`bundle sync failed: ${(e as Error).message}`)),
    );
    /**
     * eSIM plans, once a day rather than every fifteen minutes.
     *
     * The cron fires 96 times a day. The plan catalogue is ~1 500 rows and
     * 700 KB, repriced by the provider maybe weekly, and it answers slower the
     * harder it is asked — consecutive calls measured 2.4 s, 9.1 s, 25.6 s.
     * Polling it every quarter of an hour bought nothing and was almost
     * certainly what pushed it into timing out. One window a day is plenty;
     * `POST /admin/esim/sync` is there for when it cannot wait.
     */
    const hour = new Date(event.scheduledTime).getUTCHours();
    if (hour === 3) {
      ctx.waitUntil(
        import('./delivery/esim-plans')
          .then(({ syncEsimPlans }) => syncEsimPlans(env))
          .catch((e) => console.error(`esim sync failed: ${(e as Error).message}`)),
      );
      // The device list rides along: 16 KB, changed only when a handset
      // launches, and stale entries are what make a compatible phone look
      // unknown at the till.
      ctx.waitUntil(
        import('./delivery/esim-devices')
          .then(({ syncEsimDevices }) => syncEsimDevices(env))
          .catch((e) => console.error(`esim device sync failed: ${(e as Error).message}`)),
      );
    }
  },
};
