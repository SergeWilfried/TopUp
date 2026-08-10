import { ParamError } from './query';
import { now, type Env } from './env';

/**
 * Catalogue as records.
 *
 * Rows keep prose as a translation key so a stored catalogue still speaks both
 * languages; `localise` resolves them per request. Rows an operator creates
 * through the console have no key and carry their literal text instead — the
 * honest consequence of letting someone type free text into a localised list.
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

type ProductRecord = {
  id: string;
  type: string;
  name: string;
  name_key: string | null;
  country: string | null;
  network: string | null;
  terms: string;
  terms_key: string | null;
  terms_params: string | null;
  bonus: string | null;
  bonus_key: string | null;
  price: number;
  currency: string;
  days: number | null;
  enabled: number;
  sort_order: number;
};

export type Product = {
  id: string;
  type: string;
  name: string;
  country: string | null;
  network: string | null;
  terms: string;
  bonus: string | null;
  price: number;
  currency: string;
  days: number | null;
  enabled: boolean;
};

const params = (json: string | null): Record<string, string | number> | undefined => {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};

/** Key wins when present; otherwise the literal the operator typed. */
const localise = (r: ProductRecord, t: Translate): Product => ({
  id: r.id,
  type: r.type,
  name: r.name_key ? t(r.name_key) : r.name,
  country: r.country,
  network: r.network,
  terms: r.terms_key ? t(r.terms_key, params(r.terms_params)) : r.terms,
  bonus: r.bonus_key ? t(r.bonus_key) : r.bonus,
  price: r.price,
  currency: r.currency,
  days: r.days,
  enabled: Boolean(r.enabled),
});

// ── customer-facing ────────────────────────────────────────────────────────
/** Only enabled rows: disabling in the console hides a product in the apps. */
export async function publicCatalogue(env: Env, t: Translate) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM products WHERE enabled = 1 ORDER BY sort_order`,
  ).all<ProductRecord>();
  const rows = results.map((r) => localise(r, t));

  const { results: dests } = await env.DB.prepare(
    `SELECT * FROM destinations WHERE active = 1 ORDER BY sort_order`,
  ).all<{ code: string; name: string; kind: string; coverage: string; coverage_key: string | null }>();

  return {
    airtime: rows.filter((r) => r.type === 'airtime'),
    data: rows.filter((r) => r.type === 'data'),
    vpn: rows.filter((r) => r.type === 'vpn'),
    esimDestinations: dests.map((d) => ({
      name: d.name,
      code: d.code,
      type: d.kind,
      sub: d.coverage_key ? t(d.coverage_key) : d.coverage,
    })),
  };
}

export async function esimPlansForCountry(env: Env, country: string, t: Translate) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM products WHERE type = 'esim' AND country = ? AND enabled = 1 ORDER BY sort_order`,
  )
    .bind(country)
    .all<ProductRecord>();
  return results.map((r) => localise(r, t));
}

// ── console ────────────────────────────────────────────────────────────────
const SORTS: Record<string, string> = {
  price: 'p.price',
  sold: 'sold',
  name: 'p.name',
  country: 'p.country',
};

const numParam = (value: string, field: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ParamError(field, `${field}_invalid`);
  return n;
};

/**
 * Console listing. Sales are joined in SQL rather than counted per row in JS,
 * which was an N+1 over the whole orders table.
 */
export async function listProducts(env: Env, q: URLSearchParams, t: Translate) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const applied: Record<string, string> = {};
  const unset = (v: string | null): v is null => v === null || v === '' || v === 'all';

  const search = (q.get('q') ?? '').trim();
  if (search) {
    where.push(`(p.name LIKE ?1 OR p.country LIKE ?1)`);
    binds.push(`%${search}%`);
    applied.q = search;
  }
  const add = (key: string, clause: string, value: unknown) => {
    where.push(clause);
    binds.push(value);
    applied[key] = String(q.get(key));
  };

  const type = q.get('type');
  if (!unset(type)) add('type', 'p.type = ?', type);
  const network = q.get('network');
  if (!unset(network)) add('network', 'p.network = ?', network);
  const country = q.get('country');
  if (!unset(country)) add('country', 'p.country = ?', country);
  const enabled = q.get('enabled');
  if (!unset(enabled)) add('enabled', 'p.enabled = ?', enabled === 'true' ? 1 : 0);
  const minPrice = q.get('minPrice');
  if (!unset(minPrice)) add('minPrice', 'p.price >= ?', numParam(minPrice, 'minPrice'));
  const maxPrice = q.get('maxPrice');
  if (!unset(maxPrice)) add('maxPrice', 'p.price <= ?', numParam(maxPrice, 'maxPrice'));

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortKey = q.get('sort') ?? 'sold';
  const column = SORTS[sortKey];
  if (!column) throw new ParamError('sort', 'sort_unknown');
  const order = q.get('order') ?? 'desc';
  if (order !== 'asc' && order !== 'desc') throw new ParamError('order', 'order_invalid');

  const perPageRaw = Number(q.get('perPage') ?? 20);
  if (!Number.isInteger(perPageRaw) || perPageRaw < 1) throw new ParamError('perPage', 'perPage_invalid');
  const perPage = Math.min(perPageRaw, 200);

  const total =
    (
      await env.DB.prepare(`SELECT COUNT(*) AS n FROM products p ${clause}`)
        .bind(...binds)
        .first<{ n: number }>()
    )?.n ?? 0;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const pageRaw = Number(q.get('page') ?? 1);
  if (!Number.isInteger(pageRaw) || pageRaw < 1) throw new ParamError('page', 'page_invalid');
  const page = Math.min(pageRaw, pages);

  const { results } = await env.DB.prepare(
    `SELECT p.*, COALESCE(s.sold, 0) AS sold
     FROM products p
     LEFT JOIN (SELECT sku, COUNT(*) AS sold FROM orders WHERE sku IS NOT NULL GROUP BY sku) s
       ON s.sku = p.id
     ${clause}
     ORDER BY ${column} ${order === 'asc' ? 'ASC' : 'DESC'}, p.id
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, perPage, (page - 1) * perPage)
    .all<ProductRecord & { sold: number }>();

  return {
    rows: results.map((r) => ({ ...localise(r, t), sold: r.sold })),
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

export type NewProduct = {
  name?: string;
  type?: string;
  country?: string | null;
  network?: string | null;
  terms?: string;
  bonus?: string | null;
  price?: number;
};

export async function createProduct(env: Env, body: NewProduct) {
  const type = body.type;
  const name = (body.name ?? '').trim();
  const terms = (body.terms ?? '').trim();
  const price = Number(body.price);

  if (!type || !['airtime', 'data', 'esim', 'vpn'].includes(type))
    return { error: 'type_invalid', field: 'type', status: 400 } as const;
  if (!name) return { error: 'name_required', field: 'name', status: 400 } as const;
  if (!terms) return { error: 'terms_required', field: 'terms', status: 400 } as const;
  if (!Number.isFinite(price) || price <= 0)
    return { error: 'price_invalid', field: 'price', status: 400 } as const;

  const network = type === 'vpn' ? null : type === 'esim' ? 'Travel' : (body.network ?? null);
  if (type === 'airtime' || type === 'data') {
    if (!network) return { error: 'network_required', field: 'network', status: 400 } as const;
  }
  const country = type === 'vpn' ? null : (body.country ?? 'Côte d’Ivoire');

  const id = `custom-${type}-${name}-${network ?? 'any'}`.toLowerCase().replace(/\s+/g, '-');
  const exists = await env.DB.prepare(`SELECT 1 FROM products WHERE id = ?`).bind(id).first();
  if (exists) return { error: 'already_exists', field: 'name', status: 409 } as const;

  const next =
    (
      await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM products`).first<{
        n: number;
      }>()
    )?.n ?? 0;

  // No translation keys: operator-authored text is stored as typed and will
  // read the same in both languages.
  await env.DB.prepare(
    `INSERT INTO products (id, type, name, country, network, terms, bonus, price, days, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
  )
    .bind(id, type, name, country, network, terms, (body.bonus ?? '') || null, price, next, now())
    .run();

  return { ok: true, id } as const;
}

export async function setProductEnabled(env: Env, id: string, enabled: boolean) {
  const res = await env.DB.prepare(`UPDATE products SET enabled = ? WHERE id = ?`)
    .bind(enabled ? 1 : 0, id)
    .run();
  return res.meta.changes > 0;
}

// ── destinations ───────────────────────────────────────────────────────────
export async function listDestinations(env: Env, t: Translate) {
  const { results } = await env.DB.prepare(
    `SELECT d.code, d.name, d.kind, d.coverage, d.coverage_key, d.active,
            (SELECT COUNT(*) FROM products p WHERE p.country = d.name) AS plans,
            (SELECT COUNT(*) FROM orders o WHERE o.product = 'esim' AND o.detail LIKE '%' || d.name || '%') AS sold
     FROM destinations d ORDER BY d.sort_order`,
  ).all<{
    code: string;
    name: string;
    kind: string;
    coverage: string;
    coverage_key: string | null;
    active: number;
    plans: number;
    sold: number;
  }>();

  return results.map((d) => ({
    code: d.code,
    name: d.name,
    type: d.kind,
    sub: d.coverage_key ? t(d.coverage_key) : d.coverage,
    active: Boolean(d.active),
    plans: d.plans,
    sold: d.sold,
  }));
}

export async function createDestination(
  env: Env,
  body: { name?: string; code?: string; sub?: string; type?: string },
) {
  const name = (body.name ?? '').trim();
  const code = (body.code ?? '').trim().toUpperCase();
  const coverage = (body.sub ?? '').trim();

  if (name.length < 2) return { error: 'name_required', field: 'name', status: 400 } as const;
  if (!/^[A-Z]{2}$/.test(code)) return { error: 'code_invalid', field: 'code', status: 400 } as const;
  if (!coverage) return { error: 'coverage_required', field: 'sub', status: 400 } as const;
  if (!['home', 'travel', 'region'].includes(body.type ?? ''))
    return { error: 'type_invalid', field: 'type', status: 400 } as const;

  const exists = await env.DB.prepare(`SELECT 1 FROM destinations WHERE code = ?`).bind(code).first();
  if (exists) return { error: 'code_taken', field: 'code', status: 409 } as const;

  const next =
    (
      await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM destinations`).first<{
        n: number;
      }>()
    )?.n ?? 0;

  await env.DB.prepare(
    `INSERT INTO destinations (code, name, kind, coverage, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)`,
  )
    .bind(code, name, body.type!, coverage, next)
    .run();

  return { ok: true, code, name, sub: coverage, type: body.type!, active: true, plans: 0, sold: 0 } as const;
}
