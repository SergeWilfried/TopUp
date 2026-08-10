// Which rail serves which market, and in what currency.
//
// This is shared by the apps and the worker so the payment options a customer
// sees are the ones the backend will actually accept. Prices are held in XOF;
// every rail except PawaPay has to be charged in its own currency, because
// Stripe and Paystack do not settle XOF at all.

/** Minor units per major unit. XOF has none — one franc is indivisible. */
export const CURRENCY_DECIMALS = {
  XOF: 0,
  EUR: 2,
  USD: 2,
  CAD: 2,
  GBP: 2,
  NGN: 2,
  KES: 2,
  ZAR: 2,
};

// WAEMU/UEMOA — the eight states sharing the West African CFA franc.
const WAEMU = ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'];

// Countries in the eurozone plus the wider SEPA/EEA markets Stripe serves.
const EUROZONE = [
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
];

/**
 * One entry per country we can charge. `provider` is the rail, `currency` is
 * what the customer is billed in.
 */
export const PAYMENT_ROUTES = {
  ...Object.fromEntries(WAEMU.map((c) => [c, { provider: 'pawapay', currency: 'XOF' }])),

  NG: { provider: 'paystack', currency: 'NGN' },
  KE: { provider: 'paystack', currency: 'KES' },
  ZA: { provider: 'paystack', currency: 'ZAR' },

  US: { provider: 'stripe', currency: 'USD' },
  CA: { provider: 'stripe', currency: 'CAD' },
  GB: { provider: 'stripe', currency: 'GBP' },
  ...Object.fromEntries(EUROZONE.map((c) => [c, { provider: 'stripe', currency: 'EUR' }])),
};

export const PROVIDER_LABELS = {
  pawapay: 'Mobile money',
  paystack: 'Card or bank',
  stripe: 'Card',
};

/** The rail for a country, or null where we cannot take money yet. */
export const routeForCountry = (country) =>
  (country && PAYMENT_ROUTES[String(country).toUpperCase()]) || null;

export const isSupportedCountry = (country) => routeForCountry(country) !== null;

/** Mobile money is only meaningful where the carrier operates. */
export const MOBILE_MONEY_CARRIERS = {
  CI: ['Orange', 'MTN', 'Moov'],
  SN: ['Orange', 'Free'],
  BJ: ['MTN', 'Moov'],
  BF: ['Orange', 'Moov'],
  ML: ['Orange', 'Moov'],
  NE: ['Orange', 'Moov'],
  TG: ['Moov'],
  GW: ['MTN'],
};

/**
 * Whether this country can be charged on that wallet.
 *
 * The carrier is chosen by the customer and checked against this list rather
 * than inferred from the number's prefix. Prefix tables differ per country and
 * are re-issued as ranges are allocated; guessing wrong would hand the payment
 * to the wrong provider, which fails far less visibly than asking does.
 */
export const carrierAllowed = (country, carrier) =>
  (MOBILE_MONEY_CARRIERS[String(country ?? '').toUpperCase()] ?? []).includes(carrier);

/**
 * International dialling codes, needed to put an MSISDN in the form providers
 * expect. Customers type national numbers, so the country doing the paying —
 * not the one being travelled to — decides the prefix.
 */
export const DIALLING_CODES = {
  CI: '225', SN: '221', BF: '226', BJ: '229', ML: '223',
  NE: '227', TG: '228', GW: '245',
  NG: '234', KE: '254', RW: '250', ZA: '27',
  US: '1', CA: '1', GB: '44', CN: '86', TR: '90',
};

export const diallingCodeFor = (country) => DIALLING_CODES[String(country ?? '').toUpperCase()] ?? null;

/**
 * ISO 3166-1 alpha-3, which is what PawaPay speaks. We key everything on
 * alpha-2, so a translation is needed to check that the country a provider was
 * predicted for is the country we are charging.
 */
export const ISO3 = {
  CI: 'CIV', SN: 'SEN', BF: 'BFA', BJ: 'BEN', ML: 'MLI',
  NE: 'NER', TG: 'TGO', GW: 'GNB',
  NG: 'NGA', KE: 'KEN', RW: 'RWA', ZA: 'ZAF',
};

export const iso3For = (country) => ISO3[String(country ?? '').toUpperCase()] ?? null;

/**
 * Converts a XOF price into the customer's currency.
 *
 * `rates` maps a currency to how many units one XOF buys. XOF→EUR is a fixed
 * peg (655.957 XOF = 1 EUR) and never moves; everything else floats and must
 * come from a rate feed.
 */
export const convertFromXof = (amountXof, currency, rates) => {
  if (currency === 'XOF') return amountXof;
  const rate = rates?.[currency];
  if (!rate) return null;
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const converted = amountXof * rate;
  // Round up to the minor unit: never undercharge because of rounding.
  const factor = 10 ** decimals;
  return Math.ceil(converted * factor) / factor;
};

/** Amount in the smallest unit the provider's API expects. */
export const toMinorUnits = (amount, currency) =>
  Math.round(amount * 10 ** (CURRENCY_DECIMALS[currency] ?? 2));

export const EUR_PEG = 655.957;

/**
 * Flag for a two-letter location code.
 *
 * Codes are turned into regional-indicator pairs, which every platform renders
 * as that country's flag. Every destination and every VPN endpoint is a single
 * country, so a plain ISO mapping is correct — no pseudo-codes to special-case.
 * Callers fall back to showing the code when this returns null.
 */
const INDICATOR_A = 0x1f1e6;

export const flagFor = (code) => {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return String.fromCodePoint(
    INDICATOR_A + (c.charCodeAt(0) - 65),
    INDICATOR_A + (c.charCodeAt(1) - 65),
  );
};

/**
 * Countries offerable in a phone-number country picker.
 *
 * Only markets that have both a dialling code and a rail: showing a code we
 * cannot charge would let a customer choose their way into a dead end at the
 * payment step. Names are translation keys so the list reads in either
 * language — the dialling code and flag carry the meaning regardless.
 */
export const PAYABLE_COUNTRIES = Object.keys(DIALLING_CODES)
  .filter((code) => routeForCountry(code))
  .map((code) => ({ code, dial: DIALLING_CODES[code], nameKey: `country.${code}` }));
