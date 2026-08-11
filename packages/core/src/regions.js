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

/**
 * The exact number a provider will be given, in E.164.
 *
 * Shared by the app and the worker so what the customer is shown is what gets
 * texted — the two drifting apart is how a login code reaches a stranger.
 *
 * Precedence: a dialling code the customer typed themselves beats the country
 * picker, because typing `+226…` is an explicit statement and the picker may
 * simply be sitting on its default.
 *
 * Returns null rather than guessing. A national number is only meaningful in
 * its own country, so an implausible result means we do not know the number —
 * and not sending is always better than sending to the wrong handset.
 */
/**
 * Accepted national subscriber lengths per market.
 *
 * This exists because "strip the leading zero" is not a universal rule. In
 * Burkina Faso a subscriber number is 8 digits and +226 makes 11. In Côte
 * d'Ivoire the 2021 renumbering made it 10 digits whose first digit is part of
 * the number, not a trunk prefix — so +225 0709551234 is correct, and stripping
 * that zero produces a different, possibly real, subscriber.
 *
 * Only listed markets can be resolved. An unlisted one is refused rather than
 * guessed: add its rule before selling into it.
 */
export const NATIONAL_LENGTHS = {
  BF: [8],
  CI: [10],
};

export const nationalLengthsFor = (country) =>
  NATIONAL_LENGTHS[String(country ?? '').toUpperCase()] ?? null;

export const toE164 = (raw, country) => {
  const trimmed = String(raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Stated explicitly by the customer.
  if (trimmed.startsWith('+')) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    return rest.length >= 8 ? `+${rest}` : null;
  }

  const dial = diallingCodeFor(country);
  if (!dial) return null;

  // Already international without the plus — do not prefix it twice.
  const lengths = nationalLengthsFor(country);
  if (digits.startsWith(dial) && lengths?.includes(digits.length - dial.length)) return `+${digits}`;

  // Whether a leading zero is a trunk prefix or part of the number depends on
  // the market, so try both and keep the one that is a valid length there.
  const candidates = [digits, digits.replace(/^0+/, '')];
  if (lengths) {
    const match = candidates.find((n) => lengths.includes(n.length));
    return match ? `+${dial}${match}` : null;
  }

  // Unlisted market: no length rule to check against, so refuse rather than
  // send a code to whatever the digits happen to spell.
  return null;
};

/** Canonical account identity: E.164 without the plus, or null when unknown. */
export const canonicalMsisdn = (raw, country) => {
  const e164 = toE164(raw, country);
  return e164 ? e164.slice(1) : null;
};

/**
 * Merchant-payment USSD, per market and wallet.
 *
 * `{merchant}` is substituted with your merchant code. Deliberately no amount
 * placeholder: these codes open the operator's merchant-payment menu, and the
 * customer types the amount and their PIN inside that session. So the app has
 * to tell them the figure, and the backend cannot assume the amount it asked
 * for is the amount that arrives — which is why collection matches on amount
 * rather than trusting it.
 *
 * Operator facts, like dialling codes. A market with no entry simply does not
 * offer the dial rail.
 */
export const MOMO_MERCHANT_USSD = {
  BF: {
    Orange: '*144*10*{merchant}*{amount}#',
    Moov: '*555*4*1*{merchant}*{amount}#',
  },
};

/** Whether a market and wallet can be paid by dialling at all. */
export const dialSupported = (country, carrier) =>
  Boolean(MOMO_MERCHANT_USSD[String(country ?? '').toUpperCase()]?.[carrier]);

/**
 * Builds the string the customer dials.
 *
 * The amount is carried in the code rather than typed into the operator's menu.
 * That is the whole point of the {amount} slot: a figure the customer keys in by
 * hand is a figure that arrives wrong, and an inbound mobile-money credit that
 * does not match any waiting order has to sit unallocated until a human sorts
 * it out. Substituting it here removes that failure entirely.
 *
 * Returns null rather than a half-substituted string on any bad input. A USSD
 * code containing a literal placeholder — or a decimal point, which these menus
 * cannot carry — is one the customer simply cannot dial, so failing loudly at
 * the source beats shipping something broken to a handset.
 */
export const merchantUssdFor = (country, carrier, merchantCode, amount) => {
  const tpl = MOMO_MERCHANT_USSD[String(country ?? '').toUpperCase()]?.[carrier];
  if (!tpl || !merchantCode) return null;

  let out = tpl.replace('{merchant}', String(merchantCode));

  if (out.includes('{amount}')) {
    // These markets are all XOF, which has no minor unit, so a whole number is
    // the only thing the menu accepts.
    if (!Number.isInteger(amount) || amount <= 0) return null;
    out = out.replace('{amount}', String(amount));
  }

  // Anything left unsubstituted means the template gained a slot this function
  // does not know how to fill; better no code than a broken one.
  return out.includes('{') ? null : out;
};

/**
 * The country an already-canonical number belongs to.
 *
 * A stored identity is E.164 digits, which names its country unambiguously —
 * far better evidence than a picker sitting on its launch default. Used for a
 * signed-in customer, whose own number is known, so the payer country stops
 * depending on what the picker happened to say at sign-in.
 *
 * Matched on dialling code *and* national length, so +225 and +22 cannot be
 * confused and a wrong-length number resolves to nothing rather than to a
 * neighbouring market.
 */
export const countryFromCanonical = (digits) => {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (!d) return null;
  const hits = Object.entries(DIALLING_CODES)
    .filter(([code, dial]) => {
      if (!d.startsWith(dial)) return false;
      const lengths = nationalLengthsFor(code);
      return lengths ? lengths.includes(d.length - dial.length) : false;
    })
    // Longest dialling code wins, so '225' beats a hypothetical '22'.
    .sort((a, b) => b[1].length - a[1].length);
  return hits.length ? hits[0][0] : null;
};
