import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicCatalogue, esimPlansForCountry } from './catalogue';
import { translator } from './i18n';
import admin from './admin';
import checkout from './checkout/routes';
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

// Everything under /admin backs the console: dashboard, transactions,
// customers, subscriptions and catalogue management.
app.route('/admin', admin);

// Customer purchases: order + payment, provider handoff, callbacks.
app.route('/checkout', checkout);

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
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
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
  },
};
