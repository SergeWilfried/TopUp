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

export const apiSend = async <T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> =>
  (await parse(
    await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }),
  )) as T;

// ── row shapes returned by the worker ──────────────────────────────────────
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
  customers: number;
  avgOrder: number;
  failureRate: number;
  activeVpn: number;
  expiringVpn: number;
  revenueByProduct: { product: string; total: number; count: number }[];
  revenueSeries: number[];
};

export type OrderStatus = 'delivered' | 'pending' | 'failed' | 'refunded';
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
