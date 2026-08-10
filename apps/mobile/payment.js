import { getLocales, getCalendars } from 'expo-localization';
import {
  CURRENCY_DECIMALS,
  MOBILE_MONEY_CARRIERS,
  PROVIDER_LABELS,
  routeForCountry,
} from '@topup/core';

/**
 * Where the customer is, and therefore how they can pay.
 *
 * Rails are regional: mobile money only exists where the carriers do, and
 * Stripe cannot settle XOF at all. Offering a method the backend would reject
 * wastes the customer's time at the last step of a purchase, so the app asks
 * the same question the server will.
 */

/**
 * Best-effort region. The device locale is what we have without asking for
 * location permission, which would be a heavy prompt for choosing a payment
 * button. The dialling code of the number being topped up is a better signal
 * when we have one, so `detectCountry` prefers it.
 */
export const deviceCountry = () => {
  const fromLocale = getLocales()?.[0]?.regionCode;
  if (fromLocale) return String(fromLocale).toUpperCase();
  // Some Android builds report the region only on the calendar.
  const fromCalendar = getCalendars()?.[0]?.timeZone;
  return fromCalendar?.startsWith('Africa/Abidjan') ? 'CI' : null;
};

// Dialling codes for the markets we route. Enough to tell WAEMU apart, which
// is the case that matters — they share +22x prefixes.
const DIALLING = [
  ['225', 'CI'], ['221', 'SN'], ['229', 'BJ'], ['226', 'BF'],
  ['223', 'ML'], ['227', 'NE'], ['228', 'TG'], ['245', 'GW'],
  ['234', 'NG'], ['254', 'KE'], ['27', 'ZA'],
  ['1', 'US'], ['33', 'FR'], ['44', 'GB'],
];

export const countryFromMsisdn = (msisdn) => {
  const digits = String(msisdn ?? '').replace(/\D/g, '');
  if (!digits.startsWith('00') && !String(msisdn ?? '').trim().startsWith('+')) return null;
  const international = digits.replace(/^00/, '');
  const hit = DIALLING.find(([code]) => international.startsWith(code));
  return hit ? hit[1] : null;
};

/** An explicit choice beats the number, which beats the device locale. */
export const detectCountry = ({ chosen, msisdn } = {}) =>
  chosen ?? countryFromMsisdn(msisdn) ?? deviceCountry() ?? 'CI';

/**
 * The payment options to render. Returns an empty list where we cannot take
 * money, so the caller can say so rather than showing a dead button.
 */
export const methodsFor = (country) => {
  const route = routeForCountry(country);
  if (!route) return { supported: false, currency: null, methods: [] };

  if (route.provider === 'pawapay') {
    const carriers = MOBILE_MONEY_CARRIERS[country] ?? [];
    return {
      supported: true,
      provider: route.provider,
      currency: route.currency,
      methods: carriers.map((carrier) => ({
        id: `momo:${carrier}`,
        kind: 'momo',
        carrier,
        title: carrier === 'MTN' ? 'MTN MoMo' : `${carrier} Money`,
      })),
    };
  }

  return {
    supported: true,
    provider: route.provider,
    currency: route.currency,
    methods: [{ id: route.provider, kind: 'card', title: PROVIDER_LABELS[route.provider] }],
  };
};

/** Formats a converted amount for display. XOF shows no decimals. */
export const formatMoney = (amount, currency) => {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const body = Number(amount).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return currency === 'XOF' ? `${body} FCFA` : `${body} ${currency}`;
};
