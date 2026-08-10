import {
  catalogueSeed,
  destinationSeed,
  CARRIERS,
  airtimePacks,
  dataPacks,
  vpnPlans,
  esimCountries,
  esimPlansFor,
  en,
} from '@topup/core';

/**
 * Catalogue definitions plus a deterministic fixture generator.
 *
 * `products` and `destinations` are still served from memory — they are
 * definitions, not records. Customers, orders and payments now live in D1;
 * what remains of them here exists only to seed a development database via
 * POST /admin/dev/seed.
 */

// The admin console is internal and English-only.
const t = (key: string, vars?: Record<string, string | number>) => {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) return (acc as Record<string, unknown>)[part];
    return undefined;
  }, en);
  if (typeof value !== 'string') return key;
  return vars ? value.replace(/\{\{(\w+)\}\}/g, (_: string, n: string) => String(vars[n] ?? '')) : value;
};

export type Product = 'airtime' | 'data' | 'esim' | 'vpn';
export type OrderStatus = 'delivered' | 'pending' | 'failed' | 'refunded';

export type Order = {
  id: string;
  createdAt: number;
  customer: string;
  phone: string;
  product: Product;
  sku: string;
  detail: string;
  amount: number;
  method: string;
  status: OrderStatus;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  carrier: string;
  joinedAt: number;
  orders: number;
  spend: number;
  points: number;
};


const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const HOME = 'Côte d’Ivoire';

// Deterministic PRNG so every isolate seeds identical fixtures.
const rng = (seed: number) => () => {
  // True 32-bit multiply — plain `*` overflows 2^53 and the sequence degenerates.
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const rand = rng(20260808);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const FIRST = ['Kouassi', 'Aya', 'Yao', 'Adjoua', 'Koffi', 'Affoué', 'Brou', 'Mariam', 'Sekou', 'Fatou', 'Ibrahim', 'Nadège'];
const LAST = ['A.', 'B.', 'D.', 'K.', 'N.', 'T.', 'S.', 'Z.'];

const phoneFor = (carrier: string) => {
  const prefix = CARRIERS.find((c: { name: string }) => c.name === carrier)?.prefix ?? '07';
  return `${prefix} ${int(10, 99)} ${int(10, 99)} ${int(10, 99)} ${int(10, 99)}`;
};

export const customers: Customer[] = Array.from({ length: 24 }, (_, i): Customer => {
  const carrier = pick(CARRIERS).name;
  const count = int(1, 26);
  return {
    id: `C-${1200 + i}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    phone: phoneFor(carrier),
    carrier,
    joinedAt: NOW - int(5, 420) * DAY,
    orders: count,
    spend: count * int(300, 3200),
    points: int(0, 4200),
  };
});

const airtime = airtimePacks(t);
const data = dataPacks(t);
const plans = vpnPlans(t);
const countriesSeed = esimCountries(t);

// Orders are drawn from the catalogue itself, so each one records the product
// it sold. Without a `sku` the console could only guess at units sold by
// substring-matching the description.
const enT = (key: string, vars?: Record<string, string | number>) => {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) return (acc as Record<string, unknown>)[part];
    return undefined;
  }, en);
  if (typeof value !== 'string') return key;
  return vars ? value.replace(/\{\{(\w+)\}\}/g, (_: string, n: string) => String(vars[n] ?? '')) : value;
};

type SellableLine = { id: string; type: Product; detail: string; amount: number };

const sellable: SellableLine[] = catalogueSeed().map((row) => {
  const name = row.nameKey ? enT(row.nameKey) : row.name;
  const terms = row.termsKey ? enT(row.termsKey, row.termsParams ?? undefined) : '';
  const detail =
    row.type === 'airtime' ? name
    : row.type === 'vpn' ? `VPN · ${name}`
    : row.type === 'esim' ? name
    : `${name} · ${terms}`;
  return { id: row.id, type: row.type as Product, detail, amount: row.price };
});

const byType = (type: Product) => sellable.filter((l) => l.type === type);
const POOLS: Record<Product, SellableLine[]> = {
  airtime: byType('airtime'),
  data: byType('data'),
  esim: byType('esim'),
  vpn: byType('vpn'),
};

const STATUS_POOL: OrderStatus[] = [
  ...Array<OrderStatus>(16).fill('delivered'),
  'pending',
  'pending',
  'failed',
  'refunded',
];

export const orders: Order[] = Array.from({ length: 140 }, (_, i): Order => {
  const customer = pick(customers);
  const product = pick<Product>(['airtime', 'airtime', 'data', 'data', 'data', 'esim', 'vpn']);
  const line = pick(POOLS[product]);
  return {
    id: `TX-${9000 - i}`,
    // Spread evenly: clustered timestamps make week-over-week deltas swing wildly.
    createdAt: NOW - Math.floor((i / 140) * 30) * DAY - int(0, 86_000_000),
    customer: customer.name,
    phone: customer.phone,
    product,
    sku: line.id,
    detail: line.detail,
    amount: line.amount,
    method: pick(['Orange Money', 'Orange Money', 'MTN MoMo', 'Moov Money', 'Card']),
    status: pick(STATUS_POOL),
  };
}).sort((a, b) => b.createdAt - a.createdAt);

// Orders are generated against customers, so the headline figures are only
// truthful once they are derived from the rows that actually exist. Without
// this the seeded spend contradicts every total computed from the orders.
for (const c of customers) {
  const mine = orders.filter((o) => o.phone === c.phone);
  c.orders = mine.length;
  c.spend = mine.filter((o) => o.status === 'delivered').reduce((sum, o) => sum + o.amount, 0);
}


// ── development seeding ────────────────────────────────────────────────────
type SeedEnv = { DB: D1Database };

/**
 * Writes the fixtures into D1. Idempotent by construction: it clears the three
 * commerce tables first, so re-running gives the same database rather than
 * duplicating rows.
 */
export async function seedCatalogue(env: SeedEnv) {
  const products = catalogueSeed();
  const destinations = destinationSeed();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM products`),
    env.DB.prepare(`DELETE FROM destinations`),
  ]);

  const statements: D1PreparedStatement[] = destinations.map((d) =>
    env.DB.prepare(
      `INSERT INTO destinations (code, name, kind, coverage, coverage_key, active, sort_order)
       VALUES (?, ?, ?, '', ?, 1, ?)`,
    ).bind(d.code, d.name, d.kind, d.coverageKey, d.sortOrder),
  );

  for (const p of products) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO products
           (id, type, name, name_key, country, network, terms, terms_key, terms_params,
            bonus, bonus_key, price, currency, days, enabled, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        p.id,
        p.type,
        p.name,
        p.nameKey ?? null,
        p.country ?? null,
        p.network ?? null,
        p.termsKey ?? null,
        p.termsParams ? JSON.stringify(p.termsParams) : null,
        p.bonus ?? null,
        p.bonusKey ?? null,
        p.price,
        p.currency,
        p.days ?? null,
        p.sortOrder,
        Date.now(),
      ),
    );
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { products: products.length, destinations: destinations.length };
}

export async function seedCommerce(env: SeedEnv) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM payments`),
    env.DB.prepare(`DELETE FROM orders`),
    env.DB.prepare(`DELETE FROM customers`),
  ]);

  const PROVIDER: Record<string, string> = {
    'Orange Money': 'orange_money',
    'MTN MoMo': 'mtn_momo',
    'Moov Money': 'moov_money',
    Card: 'card',
  };

  const statements: D1PreparedStatement[] = [];
  for (const c of customers) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO customers (id, msisdn, name, carrier, points, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        // Digits only, matching what the auth layer stores on users.msisdn.
      ).bind(c.id, c.phone.replace(/\D/g, '').replace(/^0+/, ''), c.name, c.carrier, c.points, c.joinedAt),
    );
  }

  const byPhone = new Map(customers.map((c) => [c.phone, c.id]));
  for (const o of orders) {
    const customerId = byPhone.get(o.phone);
    if (!customerId) continue;
    const delivered = o.status === 'delivered';
    statements.push(
      env.DB.prepare(
        `INSERT INTO orders (id, customer_id, product, sku, detail, amount, status, created_at, delivered_at, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        o.id,
        customerId,
        o.product,
        o.sku,
        o.detail,
        o.amount,
        o.status,
        o.createdAt,
        delivered ? o.createdAt + 240_000 : null,
        o.status === 'failed' ? 'insufficient_funds' : null,
      ),
      env.DB.prepare(
        `INSERT INTO payments (id, order_id, provider, provider_ref, amount, status, created_at, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `pay_${o.id}`,
        o.id,
        PROVIDER[o.method] ?? 'card',
        `ref_${o.id}`,
        o.amount,
        delivered ? 'captured' : o.status === 'pending' ? 'pending' : o.status,
        o.createdAt,
        delivered ? o.createdAt + 120_000 : null,
      ),
    );
  }

  // D1 caps statements per batch; send in chunks.
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { customers: customers.length, orders: orders.length };
}
