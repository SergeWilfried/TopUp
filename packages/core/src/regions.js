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
