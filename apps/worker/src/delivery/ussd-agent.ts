import { now, randHex, sha256, type Env } from '../env';
import type { DeliveryOutcome, DeliveryProvider, DeliveryRequest } from './types';

/**
 * Airtime dispatched by a phone farm.
 *
 * Buying credit straight from the operator pays 7% where a distributor pays 2%,
 * with no float commitment and a setup cost under ten dollars. The catch is
 * that the operator's channel is manual: a person on a merchant SIM typing a
 * USSD menu. This provider turns that into a queue.
 *
 * `deliver()` therefore does not deliver. It writes a job and answers
 * `pending`, and a device claims the job, types the menu, and reports what the
 * operator said. `check()` reads the answer back. That is exactly the shape the
 * delivery port was built for — the comment on `delivery_unknown` has said
 * "because USSD will eventually be a provider here" since before this existed.
 */

/**
 * How long a device may hold a job before the worker stops waiting.
 *
 * Generous, because a USSD menu is slow and a handset on a weak signal is
 * slower. Expiry does not re-queue — see `reapExpiredLeases`.
 */
const LEASE_MS = 4 * 60_000;

/** A day, for the per-SIM transfer counters. */
const DAY_MS = 86_400_000;

export type AgentRow = {
  id: string;
  label: string | null;
  msisdn: string;
  carrier: string;
  country: string;
  active: number;
  float_balance: number | null;
  daily_cap: number | null;
  daily_count: number;
  daily_reset_at: number;
  last_seen: number | null;
};

export type JobRow = {
  id: string;
  order_id: string;
  agent_id: string | null;
  carrier: string;
  country: string;
  msisdn: string;
  amount: number;
  status: 'queued' | 'leased' | 'sent' | 'failed' | 'unknown';
  provider_ref: string | null;
  failure_reason: string | null;
};

/** Identifies the device from its bearer token. Hash compare, like sessions. */
export async function agentFromToken(env: Env, token: string): Promise<AgentRow | null> {
  if (!token) return null;
  return (
    (await env.DB.prepare(`SELECT * FROM agents WHERE token_hash = ? AND active = 1`)
      .bind(await sha256(token))
      .first<AgentRow>()) ?? null
  );
}

/**
 * Moves leases that ran out into `unknown` — never back into the queue.
 *
 * This is the single most important rule in the file. A device that claimed a
 * job and went silent may have typed the whole menu and had the handset die
 * after the operator credited the customer. Re-queueing that job sends the
 * top-up twice: the customer gets double, we pay twice, and nothing in the
 * data would ever tell us it happened. "We do not know" is a worse-sounding
 * answer and a far better one, and it is the state the rest of the system
 * already knows how to hold open for a human.
 */
export async function reapExpiredLeases(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE delivery_jobs
     SET status = 'unknown', failure_reason = 'lease_expired', updated_at = ?
     WHERE status = 'leased' AND lease_expires_at < ?`,
  )
    .bind(now(), now())
    .run();
  return res.meta.changes ?? 0;
}

/**
 * Leases one job to a device, or nothing.
 *
 * Routed by carrier because credit transfer does not cross networks, and
 * filtered by float and daily cap because a device that cannot complete a job
 * should never be given it — discovering that halfway through a USSD menu is
 * how a job becomes `unknown` for no reason.
 */
export async function claimJob(env: Env, agent: AgentRow): Promise<JobRow | null> {
  await reapExpiredLeases(env);

  const t = now();
  // Roll the daily window before reading the count, so a device that has been
  // idle overnight starts fresh rather than waiting for a separate sweep.
  if (t - agent.daily_reset_at >= DAY_MS) {
    await env.DB.prepare(`UPDATE agents SET daily_count = 0, daily_reset_at = ? WHERE id = ?`)
      .bind(t, agent.id)
      .run();
    agent.daily_count = 0;
  }
  if (agent.daily_cap !== null && agent.daily_count >= agent.daily_cap) return null;

  const candidate = await env.DB.prepare(
    `SELECT * FROM delivery_jobs
     WHERE status = 'queued' AND country = ? AND carrier = ?
       AND (? IS NULL OR amount <= ?)
     ORDER BY created_at LIMIT 1`,
  )
    .bind(agent.country, agent.carrier, agent.float_balance, agent.float_balance)
    .first<JobRow>();
  if (!candidate) return null;

  // Conditional on still being queued: two devices polling at once, and only
  // one of them gets the job. The loser simply sees nothing to do.
  const claimed = await env.DB.prepare(
    `UPDATE delivery_jobs
     SET status = 'leased', agent_id = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  )
    .bind(agent.id, t + LEASE_MS, t, candidate.id)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return null;

  await env.DB.prepare(
    `UPDATE agents SET daily_count = daily_count + 1, last_seen = ? WHERE id = ?`,
  )
    .bind(t, agent.id)
    .run();

  return { ...candidate, status: 'leased', agent_id: agent.id };
}

export type ReportInput = {
  jobId: string;
  status: 'sent' | 'failed' | 'unknown';
  providerRef?: string | null;
  raw?: string | null;
  reason?: string | null;
  balance?: number | null;
};

/**
 * Records what the device saw.
 *
 * Only the device that holds the lease may report on it, and only while the
 * job is still leased — a late report from a reaped lease must not overwrite
 * the `unknown` a human may already be working.
 */
export async function reportJob(
  env: Env,
  agent: AgentRow,
  input: ReportInput,
): Promise<{ ok: true; orderId: string; status: string } | { ok: false; error: string }> {
  const job = await env.DB.prepare(`SELECT * FROM delivery_jobs WHERE id = ?`)
    .bind(input.jobId)
    .first<JobRow>();
  if (!job) return { ok: false, error: 'job_not_found' };
  if (job.agent_id !== agent.id) return { ok: false, error: 'not_your_job' };

  const res = await env.DB.prepare(
    `UPDATE delivery_jobs
     SET status = ?, provider_ref = ?, raw_response = ?, failure_reason = ?, updated_at = ?
     WHERE id = ? AND status = 'leased'`,
  )
    .bind(
      input.status,
      input.providerRef ?? null,
      (input.raw ?? '').slice(0, 500) || null,
      input.reason ?? null,
      now(),
      job.id,
    )
    .run();
  if ((res.meta.changes ?? 0) === 0) return { ok: false, error: 'lease_lost' };

  if (typeof input.balance === 'number') {
    await env.DB.prepare(`UPDATE agents SET float_balance = ?, last_seen = ? WHERE id = ?`)
      .bind(Math.max(0, Math.round(input.balance)), now(), agent.id)
      .run();
  }
  return { ok: true, orderId: job.order_id, status: input.status };
}

const outcomeFor = (job: JobRow): DeliveryOutcome => {
  switch (job.status) {
    case 'sent':
      return { status: 'delivered', providerRef: job.provider_ref ?? job.id };
    case 'failed':
      return { status: 'failed', reason: job.failure_reason ?? 'agent_reported_failure' };
    case 'unknown':
      return { status: 'unknown', providerRef: job.provider_ref ?? job.id, reason: job.failure_reason ?? 'agent_unsure' };
    default:
      // queued or leased: still in flight, and the sweep will ask again.
      return { status: 'pending', providerRef: job.id };
  }
};

/** True when at least one live device can serve this route. */
async function hasAgentFor(env: Env, country: string, carrier: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM agents WHERE active = 1 AND country = ? AND carrier = ? LIMIT 1`,
  )
    .bind(country.toUpperCase(), carrier)
    .first<{ ok: number }>();
  return Boolean(row);
}

export function ussdAgent(env: Env): DeliveryProvider {
  return {
    name: 'ussd-agent',

    supports(req: DeliveryRequest) {
      // Off unless explicitly switched on. `supports` is synchronous, so it
      // cannot ask the database whether a device is online for this route —
      // and a provider that claims an order it then cannot serve would strand
      // it rather than letting the distributor have it. So the choice is a
      // flag, made once by a person, not inferred per order.
      if (env.AIRTIME_PROVIDER !== 'agent') return false;
      // Airtime only. A data bundle is bought by an opaque id from the
      // distributor's catalogue, which a USSD credit transfer cannot express.
      return req.product === 'airtime' && Boolean(req.network) && req.amount > 0;
    },

    /**
     * Queues rather than sends, and says so.
     *
     * `pending` is the honest answer: the money will move when a device gets
     * to it. The order sits in `delivering` meanwhile, which is exactly what
     * that status is for.
     */
    async deliver(req: DeliveryRequest): Promise<DeliveryOutcome> {
      const country = req.country.toUpperCase();
      if (!(await hasAgentFor(env, country, req.network!))) {
        return { status: 'failed', reason: 'no_agent_for_route' };
      }

      const id = `job_${randHex(8)}`;
      const t = now();
      // ON CONFLICT on the unique order_id: a redelivery of an order that
      // already has a job returns that job instead of creating a second one.
      await env.DB.prepare(
        `INSERT INTO delivery_jobs (id, order_id, carrier, country, msisdn, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
         ON CONFLICT(order_id) DO NOTHING`,
      )
        .bind(id, req.orderId, req.network, country, req.msisdn, req.amount, t, t)
        .run();

      const job = await env.DB.prepare(`SELECT * FROM delivery_jobs WHERE order_id = ?`)
        .bind(req.orderId)
        .first<JobRow>();
      return job ? outcomeFor(job) : { status: 'failed', reason: 'job_not_created' };
    },

    async check(providerRef: string): Promise<DeliveryOutcome> {
      await reapExpiredLeases(env);
      const job = await env.DB.prepare(
        `SELECT * FROM delivery_jobs WHERE id = ? OR provider_ref = ? LIMIT 1`,
      )
        .bind(providerRef, providerRef)
        .first<JobRow>();
      return job
        ? outcomeFor(job)
        : { status: 'unknown', providerRef, reason: 'job_not_found' };
    },
  };
}
