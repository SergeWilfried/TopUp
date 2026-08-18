// Catalogue, carrier rules and formatting — the app's static domain data.
import { C } from './theme';

export const fmtN = (n) => n.toLocaleString('fr-FR').replace(/[ ,]/g, ' ');
export const fmt = (n) => fmtN(n) + ' FCFA';

// The Ivorian networks with their post-2021 leading digits. Kept under this
// name because the admin console, the seed and the worker read it as "the
// home-market carrier list".
export const CARRIERS = [
  { name: 'Orange', prefix: '07' },
  { name: 'MTN', prefix: '05' },
  { name: 'Moov', prefix: '01' },
];

/**
 * Leading digits that name a network, per market.
 *
 * Only markets whose numbering plan we actually hold get an entry. Detection
 * used to apply the Ivorian table to every number, so a Burkinabè line
 * starting 05 was announced as "MTN" — a network Burkina does not have — and
 * the customer was walked into an empty pack list. A market with no table
 * gets no guess: the customer picks the network, which is the honest answer
 * when the number cannot tell us.
 */
export const NETWORK_PREFIXES = {
  CI: CARRIERS,
};

/**
 * The network a national number is on, when the market's prefixes say so.
 *
 * `country` decides which table applies; the same digits mean different
 * things in different plans. Returns null for a market without a table, or
 * a number that matches nothing — never a carrier from another country.
 */
export const detect = (phone, country = 'CI') => {
  const table = NETWORK_PREFIXES[String(country ?? '').toUpperCase()];
  if (!table) return null;
  const d = String(phone ?? '').replace(/\D/g, '');
  const c = table.find((c) => d.startsWith(c.prefix));
  return c ? c.name : null;
};

/** Prefix hint for a network in a market, or null where none is known. */
export const prefixFor = (country, network) =>
  NETWORK_PREFIXES[String(country ?? '').toUpperCase()]?.find((c) => c.name === network)?.prefix ?? null;

export const ussdFor = (carrier, amount) => {
  const codes = { Orange: '#144*82*', MTN: '*133*1*', Moov: '*855*4*' };
  return (codes[carrier] || '*100*') + amount + '#';
};

// Sizes and prices are units, so they stay literal; only prose takes a key.
export const dataPacks = (t) => [
  { n: '150 MB', v: t('packs.valid24h'), p: 200 },
  { n: '1 GB', v: t('packs.valid7d'), p: 500 },
  { n: '3 GB', v: t('packs.valid30d'), p: 1500, b: '+500 MB' },
  { n: '5 GB', v: t('packs.valid30d'), p: 2500 },
  { n: '10 GB', v: t('packs.valid30d'), p: 5000, b: '+2 GB' },
  { n: t('packs.night2gb'), v: t('packs.nightWindow'), p: 300 },
];

/**
 * Free-amount airtime.
 *
 * Bounds are shared with the worker so the keypad and the API refuse the same
 * figures — a client that allowed more than the server would send the customer
 * to a red notice at the last step. XOF has no minor unit, so whole francs.
 */
export const CUSTOM_AIRTIME = { min: 100, max: 500000 };

export const isCustomAirtimeAmount = (n) =>
  Number.isInteger(n) && n >= CUSTOM_AIRTIME.min && n <= CUSTOM_AIRTIME.max;

/** The operators' standing airtime bonus tiers, as the seeded packs show them. */
export const airtimeBonusFor = (p) => (p >= 5000 ? '+10% BONUS' : p >= 1000 ? '+5% BONUS' : null);

export const airtimePacks = (t) =>
  [500, 1000, 2000, 5000, 10000].map((p) => ({
    n: fmtN(p) + ' FCFA',
    v: t('packs.airtimeCredit'),
    p,
    b: airtimeBonusFor(p),
  }));

// Destinations as keys. `name` is the stable identity used for lookups and is
// never translated; only the coverage line is prose.
/**
 * The corridors we sell into.
 *
 * Every destination is a single country. There is no "West Africa" or "Global"
 * line, because an eSIM is provisioned on a named operator's network and no
 * such operator exists at regional scale — each country has its own set, listed
 * below. A regional tile would have had to claim a network it cannot name.
 */
export const ESIM_DESTINATIONS = [
  { name: 'Côte d’Ivoire', code: 'CI', coverageKey: 'esim.home', kind: 'home' },
  { name: 'Senegal', code: 'SN', coverageKey: 'esim.travel', kind: 'travel' },
  { name: 'Burkina Faso', code: 'BF', coverageKey: 'esim.travel', kind: 'travel' },
  { name: 'Kenya', code: 'KE', coverageKey: 'esim.travel', kind: 'travel' },
  { name: 'Rwanda', code: 'RW', coverageKey: 'esim.travel', kind: 'travel' },
  { name: 'China', code: 'CN', coverageKey: 'esim.travel', kind: 'travel' },
  { name: 'Turkey', code: 'TR', coverageKey: 'esim.travel', kind: 'travel' },
];

/**
 * Operators per corridor. One eSIM plan is one operator's network, so this is
 * what a destination can actually be sold on — not a generic "Travel" label.
 */
export const DESTINATION_NETWORKS = {
  CI: ['Orange', 'MTN', 'Moov'],
  SN: ['Orange', 'Free', 'Expresso'],
  BF: ['Orange', 'Moov', 'Telecel'],
  KE: ['Safaricom', 'Airtel'],
  RW: ['MTN', 'Airtel'],
  CN: ['China Mobile', 'China Unicom'],
  TR: ['Turkcell', 'Vodafone'],
};

export const networksFor = (code) => DESTINATION_NETWORKS[String(code ?? '').toUpperCase()] ?? [];

export const esimCountries = (t) =>
  ESIM_DESTINATIONS.map((d) => ({ name: d.name, code: d.code, sub: t(d.coverageKey), type: d.kind }));

/**
 * Plan tiers, one set for the home market and one for the corridors.
 *
 * Kept here so the seeded catalogue and this local fallback cannot drift: they
 * both expand the same tiers across whatever operators the destination has.
 */
const ESIM_TIERS = {
  home: [
    { size: '5 GB', termsKey: 'esim.localValid30', price: 3000 },
    { size: '10 GB', termsKey: 'esim.localValid30', price: 5000, bonus: '+1 GB' },
  ],
  travel: [
    { size: '1 GB', termsKey: 'esim.travelValid', termsParams: { days: 7 }, price: 3500 },
    { size: '3 GB', termsKey: 'esim.travelValid', termsParams: { days: 15 }, price: 7500, bonusKey: 'esim.popular' },
    { size: '10 GB', termsKey: 'esim.travelValid', termsParams: { days: 30 }, price: 16000 },
  ],
};

/** One row per operator per tier — an eSIM is always sold on a named network. */
export const esimPlanSeed = (dest) =>
  networksFor(dest.code).flatMap((network) =>
    ESIM_TIERS[dest.kind === 'home' ? 'home' : 'travel'].map((tier) => ({
      name: `${network} · ${tier.size}`,
      network,
      termsKey: tier.termsKey,
      termsParams: tier.termsParams ?? null,
      bonus: tier.bonus ?? null,
      bonusKey: tier.bonusKey ?? null,
      price: tier.price,
    })),
  );

export const esimPlansFor = (name, t) => {
  const dest = ESIM_DESTINATIONS.find((d) => d.name === name) ?? ESIM_DESTINATIONS[0];
  return esimPlanSeed(dest).map((p) => ({
    n: p.name,
    v: t(p.termsKey, p.termsParams ?? undefined),
    p: p.price,
    b: p.bonusKey ? t(p.bonusKey) : p.bonus,
    carrier: p.network,
  }));
};

// ---------- VPN ----------
// Premium add-on. One WireGuard tunnel per server, so a subscription hands the
// customer one config (and one QR) per location they can reach.
export const vpnPlans = (t) => [
  { n: t('vpn.plan7'), v: t('vpn.planDevices2'), p: 3000, days: 7 },
  { n: t('vpn.plan30'), v: t('vpn.planDevices2'), p: 6000, days: 30, b: t('vpn.popular') },
  { n: t('vpn.plan90'), v: t('vpn.planDevices5'), p: 15000, days: 90 },
  { n: t('vpn.plan365'), v: t('vpn.planDevices5'), p: 45000, days: 365, b: t('vpn.bestValue') },
];

export const VPN_LOCATIONS = [
  { name: 'Abidjan', code: 'CI', host: 'abj1.vpn.tofee.app' },
  { name: 'Paris', code: 'FR', host: 'par1.vpn.tofee.app' },
  { name: 'London', code: 'GB', host: 'lon1.vpn.tofee.app' },
  { name: 'Dubai', code: 'AE', host: 'dxb1.vpn.tofee.app' },
  { name: 'New York', code: 'US', host: 'nyc1.vpn.tofee.app' },
];

// Stand-in for the key material the server would issue at purchase time.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const fakeKey = (seed) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 43; i++) {
    // Math.imul keeps this a true 32-bit multiply; plain `*` overflows 2^53
    // and the low bits round away, collapsing the output to a single character.
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out += B64[h % 64];
  }
  return out + '=';
};

// The exact text a WireGuard QR code encodes — the app parses this verbatim.
export const wgConfigFor = (loc, token) => [
  '[Interface]',
  'PrivateKey = ' + fakeKey(token + loc.code + 'priv'),
  'Address = 10.7.0.' + ((loc.code.charCodeAt(0) % 200) + 20) + '/32',
  'DNS = 1.1.1.1',
  '',
  '[Peer]',
  'PublicKey = ' + fakeKey(loc.host + 'pub'),
  'AllowedIPs = 0.0.0.0/0, ::/0',
  'Endpoint = ' + loc.host + ':51820',
  'PersistentKeepalive = 25',
  '',
].join('\n');

// Subscriptions store an epoch so renewals can do date arithmetic; this is the
// only place it gets turned into something a human reads.
export const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Stored under this key so a subscription survives a restart — without it a
// paying customer loses their VPN with no way back.
export const VPN_STORE = 'topup.vpn';

export const configFileName = (loc) => 'tofee-' + loc.name.toLowerCase().replace(/\s+/g, '-') + '.conf';

// Route 2 — iOS installs a signed profile straight from Safari, no app store.
export const mobileconfigUrl = (token, loc) =>
  'https://vpn.tofee.app/ios/' + token + '/' + loc.code.toLowerCase() + '.mobileconfig';

export const WG_APP_STORE = {
  ios: 'https://apps.apple.com/app/wireguard/id1441195209',
  android: 'https://play.google.com/store/apps/details?id=com.wireguard.android',
};

export const redeemable = (t) => [
  { name: t('rewards.airtime500'), cost: 500 },
  { name: t('rewards.data1gb'), cost: 900 },
  { name: t('rewards.airtime5000'), cost: 4500 },
];

// The four bottom-tab destinations, in order.
export const navItems = (t) => [
  { label: t('nav.home'), val: 'home' },
  { label: t('nav.history'), val: 'history' },
  { label: t('nav.rewards'), val: 'rewards' },
  { label: t('nav.profile'), val: 'profile' },
];

export const TAB_SCREENS = ['home', 'history', 'rewards', 'profile'];

// Set once the intro has been completed or skipped — it never shows again on this device.
export const SEEN_ONBOARDING = 'topup.onboarding.seen';

// Three-step intro shown before auth — one slide per service.
export const onboardingSlides = (t) => [
  {
    key: 'airtime',
    kicker: t('onboarding.airtimeKicker'),
    glyph: '₣',
    title: t('onboarding.airtimeTitle'),
    body: t('onboarding.airtimeBody'),
    // Full light on red: the translucent version fell to 3.0:1 for 13px body.
    bg: C.accent, fg: C.bg, dim: C.bg, kick: C.bg,
  },
  {
    key: 'data',
    kicker: t('onboarding.dataKicker'),
    glyph: 'GB',
    title: t('onboarding.dataTitle'),
    body: t('onboarding.dataBody'),
    bg: C.text, fg: C.bg, dim: 'rgba(243,242,242,0.7)', kick: C.accent,
  },
  {
    key: 'esim',
    kicker: t('onboarding.esimKicker'),
    glyph: 'eSIM',
    title: t('onboarding.esimTitle'),
    body: t('onboarding.esimBody'),
    // Small red type on a light ground takes the deep accent (see theme.js).
    bg: C.surface, fg: C.text, dim: C.muted, kick: C.accentText, bordered: true,
  },
];
