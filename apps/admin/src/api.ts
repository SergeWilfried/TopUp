const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  hasPrev: boolean;
  hasNext: boolean;
  sort: string | null;
  order: 'asc' | 'desc';
  applied: Record<string, string>;
};

export type Params = Record<string, string | number | boolean | undefined | null>;

/** Carries the worker's `{error, field}` so a form can point at the bad input. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field?: string,
  ) {
    super(code);
  }
}

export const qs = (params: Params = {}) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // Skip empties so "no opinion" never narrows the result set.
    if (v === undefined || v === null || v === '') continue;
    out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
};

/** Set by auth.ts; read here so every request carries the session. */
const authHeader = (): Record<string, string> => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('topup.admin.token') : null;
  return token ? { authorization: `Bearer ${token}` } : {};
};

const parse = async (res: Response) => {
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (res.status === 401) {
    // The session is gone or expired; drop it so the shell shows the sign-in.
    localStorage.removeItem('topup.admin.token');
  }
  if (!res.ok) {
    throw new ApiError(res.status, String(body.error ?? `http_${res.status}`), body.field as string | undefined);
  }
  return body;
};

export const apiGet = async <T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> =>
  // An operations console must never read from the HTTP cache — the operator
  // has often just changed the thing they are looking at.
  (await parse(
    await fetch(`${BASE}${path}${qs(params)}`, { signal, cache: 'no-store', headers: authHeader() }),
  )) as T;

export const apiSend = async <T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
): Promise<T> =>
  (await parse(
    await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }),
  )) as T;

// ── row shapes returned by the worker ──────────────────────────────────────
export type Flags = {
  features: { name: string; label: string; default: boolean }[];
  /** Only the markets that deviate; everything else follows the default. */
  overrides: { feature: string; country: string; enabled: boolean; note: string | null; updated_at: number }[];
};

export type Stats = {
  revenue: number;
  /** Service fees kept out of turnover — what the business actually earns. */
  fees: number;
  revenue7: number;
  revenueDelta: number;
  orders: number;
  orders7: number;
  pending: number;
  refunded: number;
  /** Money taken and nothing delivered — a refund is owed. */
  deliveryFailed: number;
  /** Outcome never established. Waits for a person; never auto-retried. */
  deliveryUnknown: number;
  /** Paid over an hour ago and still moving. Stuck, not in flight. */
  stalled: number;
  customers: number;
  avgOrder: number;
  failureRate: number;
  activeVpn: number;
  expiringVpn: number;
  revenueByProduct: { product: string; total: number; count: number }[];
  revenueSeries: number[];
};

/**
 * Prepaid balance on a delivery rail.
 *
 * Both rails are prepaid, so these are the numbers that say whether tomorrow's
 * orders can be delivered. Every rail carries its own status: one being down
 * must not hide another being healthy.
 */
export type RailBalance = {
  rail: 'lafricamobile' | 'yesim';
  label: string;
  status: 'ok' | 'not_configured' | 'error';
  error?: string;
  balances?: { country: string; balance: number }[];
  amount?: number;
  currency?: string;
  xof?: number;
  /** Roughly how many more sales the wallet covers at current prices. */
  covers?: number | null;
};

/**
 * Every status the worker can actually write — not a friendlier subset of them.
 *
 * The four-value version of this type was a quiet outage: `delivery_failed` and
 * `delivery_unknown` fell through the tone map and rendered as `tag undefined`,
 * and the status filter offered no way to list them. Those are exactly the two
 * states the delivery machine leaves for a human — `delivery_unknown` is never
 * auto-retried on purpose, because retrying a top-up that may already have
 * landed pays for it twice — so being unable to see them made the queue that
 * needs an operator the one thing an operator could not find.
 */
/** One SIM on the bench. */
export type Agent = {
  id: string;
  label: string | null;
  msisdn: string;
  carrier: string;
  country: string;
  active: number;
  floatBalance: number | null;
  dailyCap: number | null;
  dailyCount: number;
  lastSeen: number | null;
  inFlight: number;
};

/** One dispatch attempt, as the SIM detail view shows it. */
export type DispatchJob = {
  id: string;
  orderId: string;
  msisdn: string;
  amount: number;
  status: 'queued' | 'leased' | 'sent' | 'failed' | 'unknown';
  failureReason: string | null;
  providerRef: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AgentDetail = {
  agent: Agent & { dailyResetAt: number; createdAt: number; scriptVersion: number | null };
  jobs: DispatchJob[];
  tally: { sent: number | null; failed: number | null; unknown: number | null };
};

/** One operator's USSD menu, as data. */
export type UssdStep = { expect: string; send: string };
export type UssdScript = {
  country: string;
  carrier: string;
  version: number;
  entry: string;
  steps: string;
  successRe: string | null;
  updatedAt: number;
};

/** A market/operator pairing, and whether it has a menu to type. */
export type DispatchRoute = {
  country: string;
  carrier: string;
  agents: number;
  activeAgents: number;
  /** Null means no USSD script published — those SIMs cannot dispatch. */
  scriptVersion: number | null;
};

export type Fleet = {
  agents: Agent[];
  queue: { queued: number | null; leased: number | null; unknown: number | null };
  routes: DispatchRoute[];
};

/** A console account, and whether it has ever managed to sign in. */
export type StaffRow = {
  id: string;
  email: string | null;
  msisdn: string | null;
  createdAt: number;
  sessions: number;
  lastSignIn: number | null;
  /** The account you are signed in as. It may not lock itself out. */
  isSelf: boolean;
};

/** Whether the front door works. Booleans only — never a secret's value. */
export type SecurityState = {
  channels: { email: boolean; sms: boolean };
  agentSigningKey: boolean;
  liveSmsAllowed: boolean;
  environment: string;
  staffCount: number;
  activeSessions: number;
};

/** One currency the payment router can land on, and whether we can price it. */
export type RateRow = {
  currency: string;
  perXof: number | null;
  /** The human direction: how many FCFA one unit is worth. */
  xofPerUnit: number | null;
  pegged: boolean;
  updatedAt: number | null;
  ageDays: number | null;
  status: 'ok' | 'missing' | 'stale';
  countries: string[];
  provider: string;
};

export type RateBook = { rows: RateRow[]; missing: number };

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'delivery_failed'
  | 'delivery_unknown'
  | 'refunded';

/** What an operator should read, rather than the column value. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'PENDING',
  paid: 'PAID',
  delivering: 'DELIVERING',
  delivered: 'DELIVERED',
  failed: 'PAYMENT FAILED',
  // Money taken, nothing given: this one owes a refund.
  delivery_failed: 'REFUND DUE',
  // We do not know whether it landed. Needs a person, never a retry.
  delivery_unknown: 'NEEDS CHECKING',
  refunded: 'REFUNDED',
};
export type ProductType = 'airtime' | 'data' | 'esim' | 'vpn';

export type Order = {
  id: string;
  createdAt: number;
  customerId: string;
  customer: string | null;
  phone: string;
  product: ProductType;
  detail: string;
  amount: number;
  method: string | null;
  status: OrderStatus;
};

export type Customer = {
  id: string;
  name: string | null;
  phone: string;
  carrier: string;
  joinedAt: number;
  orders: number;
  spend: number;
  points: number;
};

export type SubStatus = 'active' | 'expiring' | 'lapsed';

export type Subscription = {
  id: string;
  email: string;
  plan: string;
  startedAt: number | null;
  expiresAt: number;
  locations: string[];
  devices: number;
  status: SubStatus;
};

export type SubscriptionPage = Page<Subscription> & {
  counts: { active: number; expiring: number; lapsed: number; tunnels: number };
  installsByLocation: { name: string; code: string; host: string; installs: number }[];
};

export type OrderPage = Page<Order> & { settled: number; value: number };

export type CustomerPage = Page<Customer> & {
  lifetimeValue: number;
  avgLifetime: number;
  repeatBuyers: number;
  repeatRate: number;
  pointsOutstanding: number;
};

export type Product = {
  id: string;
  name: string;
  type: ProductType;
  country: string;
  network: string | null;
  terms: string;
  bonus: string | null;
  price: number;
  enabled: boolean;
  sold: number;
};

export type PaymentAttempt = {
  id: string;
  provider: string;
  providerRef: string | null;
  amount: number;
  status: string;
  createdAt: number;
  settledAt: number | null;
};

export type OrderDetail = Omit<Order, 'customer'> & {
  customer: Customer | null;
  deliveredAt: number | null;
  failureReason: string | null;
  attempts: PaymentAttempt[];
  related: { id: string; detail: string; amount: number; status: OrderStatus; createdAt: number }[];
  timeline: { step: string; at: number; done: boolean }[];
};

export type CustomerDetail = Customer & {
  recent: { id: string; detail: string; amount: number; status: OrderStatus; product: ProductType; createdAt: number }[];
  totals: {
    count: number;
    settled: number;
    failed: number;
    pending: number;
    avgOrder: number;
    lastOrderAt: number | null;
  };
  breakdown: { product: ProductType; count: number; total: number }[];
};

export type Destination = { name: string; code: string; sub: string; type: string; plans: number; sold: number };
export type Endpoint = {
  code: string;
  name: string;
  host: string;
  api_url: string;
  active: number;
  installs: number;
};

/** Providers are stored as stable slugs; these are the operator-facing names. */
const PROVIDER_LABELS: Record<string, string> = {
  orange_money: 'Orange Money',
  mtn_momo: 'MTN MoMo',
  moov_money: 'Moov Money',
  card: 'Card',
};
export const providerLabel = (slug: string | null) =>
  slug ? (PROVIDER_LABELS[slug] ?? slug) : '—';

/**
 * MSISDNs are stored as digits so phone sign-in and order history resolve to
 * one account; the console groups them back into a readable local form.
 */
export const formatMsisdn = (msisdn: string | null) => {
  if (!msisdn) return '—';
  const local = msisdn.length === 9 ? `0${msisdn}` : msisdn;
  return local.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
};
