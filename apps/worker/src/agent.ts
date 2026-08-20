import { Hono } from 'hono';
import { agentFromToken, claimJob, reportJob } from './delivery/ussd-agent';
import type { AgentRow } from './delivery/ussd-agent';
import type { Env } from './env';

/**
 * The phone farm's side of the wire.
 *
 * Devices poll; the worker never pushes. A handset on a mobile connection has
 * no stable address and no reason to be reachable, so the only direction that
 * works is outbound — the same shape as the collector already running on the
 * merchant SIM.
 *
 * Each device authenticates with its own bearer token rather than a shared
 * secret, so a lost handset is revoked by flipping one row.
 */
const agent = new Hono<{ Bindings: Env; Variables: { agent: AgentRow } }>();

agent.use('/*', async (c, next) => {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const row = await agentFromToken(c.env, token);
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  c.set('agent', row);
  await next();
});

/**
 * The menu this device should type, for its own operator.
 *
 * Served rather than compiled in: an operator reordering their menu would
 * otherwise mean reflashing every handset on the bench, by hand, during the
 * outage it caused. The device caches the last script it got and keeps using
 * it when this call fails, so a worker blip does not stop dispatch.
 */
agent.get('/script', async (c) => {
  const me = c.get('agent');
  const row = await c.env.DB.prepare(
    `SELECT version, entry, steps, success_re AS successRe FROM ussd_scripts WHERE country = ? AND carrier = ?`,
  )
    .bind(me.country, me.carrier)
    .first<{ version: number; entry: string; steps: string; successRe: string | null }>();

  if (!row) return c.json({ error: 'no_script_for_route' }, 404);

  let steps: unknown;
  try {
    steps = JSON.parse(row.steps);
  } catch {
    // A malformed script must not reach a device that would then type it at a
    // live menu. Refuse and let the console show the route as broken.
    console.error(`[ussd] script for ${me.country}/${me.carrier} is not valid JSON`);
    return c.json({ error: 'script_malformed' }, 500);
  }

  return c.json({ version: row.version, entry: row.entry, steps, successRe: row.successRe });
});

/**
 * Asks for one job, and reports the SIM's balance while asking.
 *
 * Returns 204 rather than an empty object when there is nothing to do, so a
 * device polling on a slow connection can tell "no work" from "bad response"
 * without parsing anything.
 */
agent.post('/claim', async (c) => {
  const me = c.get('agent');
  const body = (await c.req.json().catch(() => ({}))) as { balance?: unknown };

  if (typeof body.balance === 'number' && Number.isFinite(body.balance)) {
    await c.env.DB.prepare(`UPDATE agents SET float_balance = ?, last_seen = ? WHERE id = ?`)
      .bind(Math.max(0, Math.round(body.balance)), Date.now(), me.id)
      .run();
    me.float_balance = Math.max(0, Math.round(body.balance));
  } else {
    await c.env.DB.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).bind(Date.now(), me.id).run();
  }

  const job = await claimJob(c.env, me);
  if (!job) return c.body(null, 204);

  // Only what the device needs to type. It never learns the order, the
  // customer, or the price paid.
  return c.json({
    jobId: job.id,
    msisdn: job.msisdn,
    amount: job.amount,
    carrier: job.carrier,
  });
});

/**
 * Reports what the operator said.
 *
 * `unknown` is a first-class answer and devices are expected to use it: a
 * session that dropped after the confirmation step is genuinely ambiguous, and
 * guessing either way is worse than saying so. Nothing here ever re-queues.
 */
agent.post('/report', async (c) => {
  const me = c.get('agent');
  const body = (await c.req.json().catch(() => ({}))) as {
    jobId?: string;
    status?: string;
    providerRef?: string;
    raw?: string;
    reason?: string;
    balance?: number;
  };

  if (!body.jobId || !['sent', 'failed', 'unknown'].includes(String(body.status))) {
    return c.json({ error: 'job_id_and_status_required' }, 400);
  }

  const result = await reportJob(c.env, me, {
    jobId: body.jobId,
    status: body.status as 'sent' | 'failed' | 'unknown',
    providerRef: body.providerRef,
    raw: body.raw,
    reason: body.reason,
    balance: body.balance,
  });
  if (!result.ok) return c.json({ error: result.error }, result.error === 'job_not_found' ? 404 : 409);

  // Settle immediately rather than waiting for the sweep: the customer is
  // very likely still watching the pay screen.
  //
  // `recheckOrder`, not `deliverOrder` — the order is already `delivering`, so
  // the delivery path would no-op on its own guard. Recheck reads the job we
  // just wrote and settles from it, which is the same code the console button
  // and the cron use.
  const { recheckOrder } = await import('./delivery');
  await recheckOrder(c.env, result.orderId).catch((e) =>
    console.error(`agent settle failed for ${result.orderId}: ${(e as Error).message}`),
  );

  return c.json({ ok: true, status: result.status });
});

export default agent;
