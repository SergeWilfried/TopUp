import { ParamError } from './query';
import { now, type Env } from './env';
import { REVENUE_STATUSES, sqlIn } from './delivery/types';

/**
 * Revenue is money captured and not given back, not parcels shipped.
 *
 * These aggregates all used `status = 'delivered'` as a stand-in for "we were
 * paid", which was true only while payment and delivery were the same event.
 * Now that they are not, an order paid at 23:58 and delivered at 00:02 would
 * have dropped out of the day it was actually paid for.
 *
 * Interpolated from a closed list of literals — never user input.
 */
const REVENUE_SQL = `(${sqlIn(REVENUE_STATUSES)})`;

/**
 * Orders, payments and customers, read straight from D1.
 *
 * Unlike subscriptions — where the whole set is small enough to filter in
 * memory — orders is the table that grows without bound, so the filters, sort
 * and pagination are pushed into SQL. The response envelope is identical to the
 * one `listQuery` produces, so the console cannot tell the difference.
 */

export type OrderRow = {
  id: string;
  createdAt: number;
  customerId: string;
  customer: string | null;
  phone: string;
  product: string;
  detail: string;
  amount: number;
  method: string | null;
  status: string;
};

const ORDER_SORTS: Record<string, string> = {
  date: 'o.created_at',
  amount: 'o.amount',
  customer: 'c.name',
  status: 'o.status',
};

const num = (value: string, field: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ParamError(field, `${field}_invalid`);
  return n;
};

const dateBound = (value: string, field: string) => {
  const n = Number(value);
  const ms = Number.isFinite(n) && value.trim() !== '' ? n : Date.parse(value);
  if (!Number.isFinite(ms)) throw new ParamError(field, `${field}_invalid`);
  return ms;
};

/** Builds the shared WHERE clause so the page and its totals always agree. */
function orderFilters(params: URLSearchParams) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const applied: Record<string, string> = {};
  const set = (key: string, clause: string, value: unknown) => {
    where.push(clause);
    binds.push(value);
    applied[key] = String(params.get(key));
  };
  const unset = (v: string | null): v is null => v === null || v === '' || v === 'all';

  const q = (params.get('q') ?? '').trim();
  if (q) {
    where.push(`(o.id LIKE ?1 OR o.detail LIKE ?1 OR c.name LIKE ?1 OR c.msisdn LIKE ?1)`);
    binds.push(`%${q}%`);
    applied.q = q;
  }

  const status = params.get('status');
  if (!unset(status)) set('status', 'o.status = ?', status);

  const product = params.get('product');
  if (!unset(product)) set('product', 'o.product = ?', product);

  const method = params.get('method');
  if (!unset(method)) set('method', 'pay.provider = ?', method);

  const customer = params.get('customer');
  if (!unset(customer)) set('customer', 'o.customer_id = ?', customer);

  const from = params.get('from');
  if (!unset(from)) set('from', 'o.created_at >= ?', dateBound(from, 'from'));

  const to = params.get('to');
  if (!unset(to)) set('to', 'o.created_at <= ?', dateBound(to, 'to'));

  const min = params.get('minAmount');
  if (!unset(min)) set('minAmount', 'o.amount >= ?', num(min, 'minAmount'));

  const max = params.get('maxAmount');
  if (!unset(max)) set('maxAmount', 'o.amount <= ?', num(max, 'maxAmount'));

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', binds, applied };
}

// The most recent payment attempt is what the console labels "method".
const BASE_FROM = `
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN payments pay ON pay.id = (
    SELECT id FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
  )`;

export async function listOrders(env: Env, params: URLSearchParams) {
  const { clause, binds, applied } = orderFilters(params);

  const sortKey = params.get('sort') ?? 'date';
  const column = ORDER_SORTS[sortKey];
  if (!column) throw new ParamError('sort', 'sort_unknown');
  const order = params.get('order') ?? 'desc';
  if (order !== 'asc' && order !== 'desc') throw new ParamError('order', 'order_invalid');

  const perPageRaw = Number(params.get('perPage') ?? 20);
  if (!Number.isInteger(perPageRaw) || perPageRaw < 1) throw new ParamError('perPage', 'perPage_invalid');
  const perPage = Math.min(perPageRaw, 200);

  // Totals describe the filtered set, not the visible page.
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(o.amount), 0) AS value,
            COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_SQL} THEN o.amount ELSE 0 END), 0) AS settled
     ${BASE_FROM} ${clause}`,
  )
    .bind(...binds)
    .first<{ total: number; value: number; settled: number }>();

  const total = totals?.total ?? 0;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const pageRaw = Number(params.get('page') ?? 1);
  if (!Number.isInteger(pageRaw) || pageRaw < 1) throw new ParamError('page', 'page_invalid');
  const page = Math.min(pageRaw, pages);

  const { results } = await env.DB.prepare(
    `SELECT o.id, o.created_at AS createdAt, o.customer_id AS customerId,
            c.name AS customer, c.msisdn AS phone,
            o.product, o.detail, o.amount, o.status, pay.provider AS method
     ${BASE_FROM} ${clause}
     ORDER BY ${column} ${order === 'asc' ? 'ASC' : 'DESC'}, o.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, perPage, (page - 1) * perPage)
    .all<OrderRow>();

  return {
    settled: totals?.settled ?? 0,
    value: totals?.value ?? 0,
    rows: results,
    total,
    page,
    pages,
    perPage,
    hasPrev: page > 1,
    hasNext: page < pages,
    sort: sortKey,
    order,
    applied,
  };
}

export async function getOrder(env: Env, id: string) {
  const order = await env.DB.prepare(
    `SELECT o.id, o.created_at AS createdAt, o.customer_id AS customerId,
            c.name AS customer, c.msisdn AS phone,
            o.product, o.detail, o.amount, o.status, o.delivered_at AS deliveredAt,
            o.failure_reason AS failureReason, pay.provider AS method
     ${BASE_FROM} WHERE o.id = ?`,
  )
    .bind(id)
    .first<OrderRow & { deliveredAt: number | null; failureReason: string | null }>();
  if (!order) return null;

  const { results: attempts } = await env.DB.prepare(
    `SELECT id, provider, provider_ref AS providerRef, amount, status,
            created_at AS createdAt, settled_at AS settledAt
     FROM payments WHERE order_id = ? ORDER BY created_at ASC`,
  )
    .bind(id)
    .all();

  const customer = await getCustomer(env, order.customerId);
  const { results: related } = await env.DB.prepare(
    `SELECT id, detail, amount, status, created_at AS createdAt
     FROM orders WHERE customer_id = ? AND id != ? ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(order.customerId, id)
    .all();

  // Derived from the payment attempts rather than guessed from status alone.
  const captured = (attempts as { status: string; settledAt: number | null }[]).find(
    (a) => a.status === 'captured',
  );
  const timeline = [
    { step: 'Placed', at: order.createdAt, done: true },
    {
      step: order.method === 'card' ? 'Card authorised' : 'Approved on handset',
      at: captured?.settledAt ?? order.createdAt,
      done: Boolean(captured),
    },
    {
      // The last step is no longer "Delivered unless something went wrong":
      // an order can be paid for and still be in flight, or in the state where
      // we honestly do not know, and the console has to say which.
      step:
        order.status === 'refunded'
          ? 'Refunded'
          : order.status === 'failed'
            ? 'Payment failed'
            : order.status === 'delivery_failed'
              ? 'Delivery failed — refund due'
              : order.status === 'delivery_unknown'
                ? 'Unconfirmed — needs checking'
                : order.status === 'delivered'
                  ? 'Delivered'
                  : 'Delivering',
      at: order.deliveredAt ?? order.createdAt,
      done: ['delivered', 'refunded', 'failed', 'delivery_failed'].includes(order.status),
    },
  ];

  return { ...order, customer, attempts, related, timeline };
}

// ── customers ──────────────────────────────────────────────────────────────
export type CustomerRow = {
  id: string;
  name: string | null;
  phone: string;
  carrier: string;
  joinedAt: number;
  points: number;
  orders: number;
  spend: number;
};

/**
 * Order counts and spend are computed, never stored. Denormalised copies drift:
 * the fixture version reported a lifetime spend that contradicted the rows.
 */
const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.msisdn AS phone, c.carrier, c.created_at AS joinedAt, c.points,
         COUNT(o.id) AS orders,
         COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_SQL} THEN o.amount ELSE 0 END), 0) AS spend
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id`;

export async function listCustomers(env: Env): Promise<CustomerRow[]> {
  const { results } = await env.DB.prepare(`${CUSTOMER_SELECT} GROUP BY c.id`).all<CustomerRow>();
  return results;
}

export async function getCustomer(env: Env, id: string) {
  return env.DB.prepare(`${CUSTOMER_SELECT} WHERE c.id = ? GROUP BY c.id`)
    .bind(id)
    .first<CustomerRow>();
}

export async function customerDetail(env: Env, id: string) {
  const customer = await getCustomer(env, id);
  if (!customer) return null;

  const { results: recent } = await env.DB.prepare(
    `SELECT id, detail, amount, status, product, created_at AS createdAt
     FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 8`,
  )
    .bind(id)
    .all();

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN status IN ${REVENUE_SQL} THEN amount ELSE 0 END), 0) AS settled,
            SUM(CASE WHEN status IN ('failed','refunded','delivery_failed') THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            MAX(created_at) AS lastOrderAt
     FROM orders WHERE customer_id = ?`,
  )
    .bind(id)
    .first<{ count: number; settled: number; failed: number; pending: number; lastOrderAt: number | null }>();

  const { results: breakdown } = await env.DB.prepare(
    `SELECT product, COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN status IN ${REVENUE_SQL} THEN amount ELSE 0 END), 0) AS total
     FROM orders WHERE customer_id = ? GROUP BY product ORDER BY total DESC`,
  )
    .bind(id)
    .all();

  const settled = totals?.settled ?? 0;
  const delivered = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND status IN ${REVENUE_SQL}`,
  )
    .bind(id)
    .first<{ n: number }>();

  return {
    ...customer,
    recent,
    totals: {
      count: totals?.count ?? 0,
      settled,
      failed: totals?.failed ?? 0,
      pending: totals?.pending ?? 0,
      avgOrder: delivered?.n ? Math.round(settled / delivered.n) : 0,
      lastOrderAt: totals?.lastOrderAt ?? null,
    },
    breakdown,
  };
}

// ── dashboard ──────────────────────────────────────────────────────────────
const DAY = 86_400_000;

export async function commerceStats(env: Env) {
  const t = now();
  const revenueIn = async (from: number, to: number) =>
    (
      await env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM orders
         WHERE status IN ${REVENUE_SQL} AND created_at >= ? AND created_at < ?`,
      )
        .bind(from, to)
        .first<{ v: number }>()
    )?.v ?? 0;

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status IN ${REVENUE_SQL} THEN amount ELSE 0 END), 0) AS revenue,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
            SUM(CASE WHEN status IN ('failed','refunded','delivery_failed') THEN 1 ELSE 0 END) AS unhappy
     FROM orders`,
  ).first<{
    orders: number;
    revenue: number;
    delivered: number;
    pending: number;
    refunded: number;
    unhappy: number;
  }>();

  const rev7 = await revenueIn(t - 7 * DAY, t + DAY);
  const revPrev7 = await revenueIn(t - 14 * DAY, t - 7 * DAY);

  const { results: byProduct } = await env.DB.prepare(
    `SELECT product,
            COALESCE(SUM(CASE WHEN status IN ${REVENUE_SQL} THEN amount ELSE 0 END), 0) AS total,
            COUNT(*) AS count
     FROM orders GROUP BY product`,
  ).all<{ product: string; total: number; count: number }>();

  const orders7 =
    (
      await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?`)
        .bind(t - 7 * DAY)
        .first<{ n: number }>()
    )?.n ?? 0;

  const customers =
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM customers`).first<{ n: number }>())?.n ?? 0;

  // 14 daily buckets in one pass rather than 14 round trips.
  const { results: buckets } = await env.DB.prepare(
    `SELECT CAST((created_at - ?) / ? AS INTEGER) AS bucket,
            COALESCE(SUM(amount), 0) AS total
     FROM orders
     WHERE status IN ${REVENUE_SQL} AND created_at >= ?
     GROUP BY bucket`,
  )
    .bind(t - 13 * DAY, DAY, t - 13 * DAY)
    .all<{ bucket: number; total: number }>();

  const series = Array.from({ length: 14 }, (_, i) => buckets.find((b) => b.bucket === i)?.total ?? 0);

  return {
    revenue: totals?.revenue ?? 0,
    revenue7: rev7,
    revenueDelta: revPrev7 ? Math.round(((rev7 - revPrev7) / revPrev7) * 100) : 0,
    orders: totals?.orders ?? 0,
    orders7,
    pending: totals?.pending ?? 0,
    refunded: totals?.refunded ?? 0,
    customers,
    avgOrder: totals?.delivered ? Math.round((totals.revenue ?? 0) / totals.delivered) : 0,
    failureRate: totals?.orders
      ? Math.round(((totals.unhappy ?? 0) / totals.orders) * 1000) / 10
      : 0,
    revenueByProduct: byProduct,
    revenueSeries: series,
  };
}
