import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicCatalogue, esimPlansForCountry } from './catalogue';
import { translator } from './i18n';
import admin from './admin';
import checkout from './checkout/routes';
import vpn from './vpn/routes';
import { sweep } from './vpn/sweep';
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

// Everything under /admin backs the console: dashboard, transactions,
// customers, subscriptions and catalogue management.
app.route('/admin', admin);

// Customer purchases: order + payment, provider handoff, callbacks.
app.route('/checkout', checkout);

// Customer-facing VPN control plane — auth, subscription, peers. D1-backed.
app.route('/', vpn);

// Locations come from the `servers` table, which also holds the agent URL and
// per-server token. Those two columns are never exposed here.
app.get('/servers', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name FROM servers WHERE active = 1 ORDER BY name`,
  ).all();
  return c.json({ servers: results });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,

  /** Expiry sweep and reconciliation of peers the agent and D1 disagree about. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env).catch((e) => console.error(`sweep failed: ${(e as Error).message}`)));
  },
};
