/**
 * Shared list semantics for every collection endpoint: search, declarative
 * filters, sorting and pagination behind one envelope, so a client that can
 * drive one table can drive all of them.
 */

export type SortDir = 'asc' | 'desc';

export type ListSpec<T> = {
  /** Fields concatenated for the free-text `q` parameter. */
  search?: (row: T) => (string | number | null | undefined)[];
  /**
   * Named filters. The key is the query parameter; absent, empty or `all`
   * values are skipped. Returning a ParamError marks the request invalid.
   */
  filters?: Record<string, (row: T, value: string) => boolean>;
  /** Named sorts. The key is the `sort` value; comparators sort ascending. */
  sorts?: Record<string, (a: T, b: T) => number>;
  defaultSort?: string;
  defaultOrder?: SortDir;
  defaultPerPage?: number;
  /**
   * Extra fields computed over the whole filtered set (not just the page), so
   * totals in the UI describe what the filters actually selected.
   */
  aggregate?: (rows: T[]) => Record<string, unknown>;
};

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  hasPrev: boolean;
  hasNext: boolean;
  sort: string | null;
  order: SortDir;
  /** Echo of the filters actually applied, so a client can confirm its state. */
  applied: Record<string, string>;
};

export class ParamError extends Error {
  constructor(
    readonly field: string,
    readonly code: string,
  ) {
    super(code);
  }
}

const MAX_PER_PAGE = 200;

const intParam = (params: URLSearchParams, key: string, fallback: number) => {
  const raw = params.get(key);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ParamError(key, `${key}_invalid`);
  return n;
};

/** Skipped filter values — "no opinion" rather than "match empty". */
const isUnset = (v: string | null): v is null => v === null || v === '' || v === 'all';

export function listQuery<T>(rows: T[], params: URLSearchParams, spec: ListSpec<T> = {}): Page<T> {
  const applied: Record<string, string> = {};

  // 1. free-text search
  const q = (params.get('q') ?? '').trim().toLowerCase();
  let out = rows;
  if (q && spec.search) {
    applied.q = q;
    out = out.filter((row) =>
      spec
        .search!(row)
        .some((field) => field != null && String(field).toLowerCase().includes(q)),
    );
  }

  // 2. declared filters
  for (const [key, predicate] of Object.entries(spec.filters ?? {})) {
    const value = params.get(key);
    if (isUnset(value)) continue;
    applied[key] = value;
    out = out.filter((row) => predicate(row, value));
  }

  // 3. sorting — unknown keys are a client error, not silently ignored
  const sortKey = params.get('sort') ?? spec.defaultSort ?? null;
  const orderRaw = params.get('order') ?? spec.defaultOrder ?? 'desc';
  if (orderRaw !== 'asc' && orderRaw !== 'desc') throw new ParamError('order', 'order_invalid');
  const order: SortDir = orderRaw;

  if (sortKey) {
    const comparator = spec.sorts?.[sortKey];
    if (!comparator) throw new ParamError('sort', 'sort_unknown');
    // Copy first: these arrays are the module-level store.
    out = [...out].sort((a, b) => (order === 'asc' ? comparator(a, b) : comparator(b, a)));
    applied.sort = sortKey;
    applied.order = order;
  }

  // 4. pagination
  const perPage = Math.min(intParam(params, 'perPage', spec.defaultPerPage ?? 20), MAX_PER_PAGE);
  const total = out.length;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const page = Math.min(intParam(params, 'page', 1), pages);
  const from = (page - 1) * perPage;

  return {
    ...(spec.aggregate ? spec.aggregate(out) : {}),
    rows: out.slice(from, from + perPage),
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

/** Numeric comparator that tolerates undefined. */
export const byNumber = <T>(get: (row: T) => number) => (a: T, b: T) => get(a) - get(b);
/** Locale-aware string comparator — names here include accented characters. */
export const byText = <T>(get: (row: T) => string) => (a: T, b: T) => get(a).localeCompare(get(b), 'fr');
