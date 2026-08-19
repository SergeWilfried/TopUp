/**
 * Sorting operator bundles into groups a customer can shop by.
 *
 * The distributor returns one flat list per network — twenty rows for Moov,
 * nineteen for Orange — and the app rendered it as twenty identical tiles.
 * That is bad enough as a wall of choices, but the real damage is that the
 * list is not homogeneous and never said so:
 *
 *   4 Go     1 150 F   "4 Go - TIK TOK - valide 30 jours"
 *   4 Go     3 250 F   "4 Go de connexion, validite 30 jours"
 *
 * Two tiles, the same words, a 2.8× price gap, and the cheap one will not load
 * WhatsApp. A customer scanning for "4 Go" takes the cheaper one every time.
 * Orange is worse: six of its "data" rows are international calling minutes
 * and one — "208 XOF" — contains no data at all.
 *
 * So the grouping is not decoration. Splitting these into what they actually
 * are puts the two "4 Go" tiles in different sections, which is what stops the
 * wrong purchase.
 *
 * Everything here is read out of the distributor's French prose, because that
 * is the only place it exists: `days` is NULL on every row, the app-scoped
 * bundles are not flagged, and the names are whatever marketing typed.
 */

/** Section ids, in the order a shopper should meet them. */
export const BUNDLE_GROUPS = ['internet', 'social', 'calls', 'international'];

const RE = {
  // "valide 2 jours", "une validite de 30 jours", "valable 1 jour". Note the
  // stem is `val`, not `valid`: "valable" shares no more than that, and
  // anchoring on the longer prefix silently dropped every call bundle's
  // validity.
  validity: /val(?:id\w*|able)\s*(?:de\s*)?(\d+)\s*j/i,
  minutes: /(\d+)\s*mn\b/i,
  sms: /(\d+)\s*sms\b/i,
  // "d'appels vers Orange" is a national bundle; "vers … France" is not.
  calls: /d['’]appels/i,
};

/**
 * App-scoped bundles, matched on the app names the operators actually print.
 *
 * Order matters only for the label: a bundle naming both Facebook and WhatsApp
 * should read as one offer, not two.
 */
const SCOPES = [
  { test: /tik\s*tok/i, label: 'TikTok' },
  { test: /facebook/i, label: 'Facebook' },
  { test: /whatsapp/i, label: 'WhatsApp' },
  { test: /youtube/i, label: 'YouTube' },
  { test: /instagram/i, label: 'Instagram' },
];

/**
 * Countries that make a call bundle international.
 *
 * A list rather than "any capitalised word": the terms are littered with
 * operator names and the national bundles say "vers Orange" and "vers tous les
 * operateurs nationaux", both of which would trip a looser rule.
 */
const ABROAD =
  /(côte d['’]ivoire|cote d['’]ivoire|france|usa|canada|italie|ghana|niger|togo|benin|bénin|senegal|sénégal|mali|espagne|allemagne|chine|belgique)/i;

/** "2 jours" out of the prose, or null when the row does not say. */
export function validityDays(terms) {
  const m = RE.validity.exec(String(terms ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "TikTok", "Facebook + WhatsApp", or null for a bundle with no app limit. */
export function scopeOf(terms) {
  const text = String(terms ?? '');
  const hits = SCOPES.filter((s) => s.test.test(text)).map((s) => s.label);
  return hits.length ? hits.join(' + ') : null;
}

/**
 * Which section a bundle belongs in.
 *
 * Checked most-specific first. A TikTok bundle mentions no calls, and a
 * calling bundle names no apps, so the only ordering that matters is
 * international before calls: every international row is also a call row.
 */
export function groupOf(product) {
  const terms = String(product?.terms ?? '');
  if (scopeOf(terms)) return 'social';
  if (RE.calls.test(terms) && ABROAD.test(terms)) return 'international';
  if (RE.calls.test(terms) || RE.sms.test(terms)) return 'calls';
  return 'internet';
}

/** Every country a call bundle names, in the order the prose names them. */
export function destinationsOf(terms) {
  const found = [];
  for (const m of String(terms ?? '').matchAll(new RegExp(ABROAD.source, 'gi'))) {
    const name = m[0].replace(/^./, (c) => c.toUpperCase());
    if (!found.some((f) => f.toLowerCase() === name.toLowerCase())) found.push(name);
  }
  return found;
}

/** "5mn d'appels + 5SMS + 10Mo" → "5 min + 5 SMS + 10 Mo". */
function callContents(terms) {
  const parts = [];
  const mins = RE.minutes.exec(terms);
  const sms = RE.sms.exec(terms);
  const data = /(\d+(?:[.,]\d+)?)\s*(mo|go)\b/i.exec(terms);
  if (mins) parts.push(`${mins[1]} min`);
  if (sms) parts.push(`${sms[1]} SMS`);
  if (data) parts.push(`${data[1]} ${data[2][0].toUpperCase()}${data[2].slice(1).toLowerCase()}`);
  return parts;
}

/**
 * A tile name that says what you are buying.
 *
 * The catalogue name is the operator's, and on the call bundles it is actively
 * misleading: "10 Mo" is really five minutes, five texts and a tenth of a
 * gigabyte, and "208 XOF" is a price standing in for fifteen minutes and fifty
 * texts. Left alone these sort by a number that is the least important thing
 * in the offer.
 *
 * Grouping alone is not enough here either. Orange's six international rows
 * reduce to "5 min", "5 min", "10 min", "20 min", "20 min", "10 min" — three
 * pairs of identical labels at different prices, which is the same trap as the
 * two "4 Go" tiles one section over. What separates them is where you can
 * call, so that is what the name carries.
 */
export function bundleLabel(product) {
  const name = String(product?.name ?? '').trim();
  const terms = String(product?.terms ?? '');
  const group = groupOf(product);

  // Scoped bundles collide by name inside their own section — two "4 Go" rows,
  // one TikTok and one Facebook — so the scope is part of the name there.
  if (group === 'social') {
    const scope = scopeOf(terms);
    return scope ? `${name} · ${scope}` : name;
  }

  if (group === 'international') {
    const mins = RE.minutes.exec(terms);
    const lead = mins ? `${mins[1]} min` : name;
    const where = destinationsOf(terms);
    // Two destinations name themselves; more would not fit a tile, so the
    // count carries it and the full list stays in the terms below.
    const tail =
      where.length === 0 ? '' : where.length <= 2 ? ` · ${where.join(', ')}` : ` · ${where[0]} +${where.length - 1}`;
    return `${lead}${tail}`;
  }

  if (group === 'calls') {
    const parts = callContents(terms);
    if (parts.length) return parts.join(' + ');
  }
  return name;
}

/**
 * Groups one network's bundles, dropping empty sections.
 *
 * Sections keep the order in BUNDLE_GROUPS rather than being sorted by size,
 * so the same network's shelf looks the same on every visit — a list that
 * reorders itself is one the customer has to read again each time.
 */
export function groupBundles(products) {
  const buckets = new Map(BUNDLE_GROUPS.map((g) => [g, []]));
  for (const p of products ?? []) buckets.get(groupOf(p))?.push(p);
  return BUNDLE_GROUPS.filter((g) => buckets.get(g).length).map((g) => ({
    group: g,
    items: buckets.get(g),
  }));
}
