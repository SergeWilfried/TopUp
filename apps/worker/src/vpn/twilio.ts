import { diallingCodeFor } from '@topup/core';
import type { Env } from '../env';

/**
 * Twilio SMS, used only to deliver login codes.
 *
 * The awkward part is the number. Accounts are keyed by a *national* MSISDN —
 * `normaliseMsisdn` drops the leading zero, so `0709551234` is stored as
 * `709551234` — while Twilio needs E.164. The country therefore has to come
 * from somewhere else, in this order:
 *
 *   1. the number itself, when the customer typed `+225…` or `00225…`
 *   2. a `country` sent with the request (newer app builds)
 *   3. SMS_DEFAULT_COUNTRY, the home market
 *
 * Falling through to (3) is a real limitation, not a detail: a Burkinabè
 * customer whose app sends no country would have `+226` numbers rebuilt as
 * `+225`, and the code would go to a stranger in Abidjan. Single-market launch
 * is safe; multi-market needs the app to send its picker value.
 */

export type SmsResult = { ok: true; sid: string } | { ok: false; error: string };

const configured = (env: Env) =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID));

/**
 * Best-effort E.164.
 *
 * Returns null rather than guessing when the result would be implausible — an
 * OTP delivered to the wrong handset is worse than one not delivered at all.
 */
export function toE164(raw: string, countryHint: string | null, env: Env): string | null {
  const trimmed = String(raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // (1) The customer already told us, by typing a prefix.
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  // (2) then (3).
  const country = (countryHint || env.SMS_DEFAULT_COUNTRY || 'CI').toUpperCase();
  const dial = diallingCodeFor(country);
  if (!dial) return null;

  const national = digits.replace(/^0+/, '');
  // A national subscriber number outside this range is not a phone number in
  // any market we serve; sending to it would either bounce or reach someone else.
  if (national.length < 7 || national.length > 12) return null;

  // Already carries its own dialling code (a caller that passed E.164 without
  // the plus). Prefixing again would invent a number.
  if (national.startsWith(dial) && national.length > dial.length + 6) return `+${national}`;

  return `+${dial}${national}`;
}

/**
 * Sends one message.
 *
 * Errors are returned rather than thrown: the caller decides whether a delivery
 * failure should be visible to the customer, and an OTP endpoint has to think
 * about that carefully.
 */
export async function sendSms(env: Env, to: string, body: string): Promise<SmsResult> {
  if (!configured(env)) return { ok: false, error: 'not_configured' };

  const form = new URLSearchParams({ To: to, Body: body });
  // A Messaging Service handles sender selection and per-country compliance;
  // a bare From number is the simpler setup. Either is valid, service wins.
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', env.TWILIO_FROM!);

  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  try {
    const res = await fetch(
      `${env.TWILIO_BASE_URL ?? 'https://api.twilio.com'}/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok || !data.sid) {
      // Twilio's numeric code is the actionable part (21211 invalid number,
      // 21608 unverified recipient on a trial account, 20003 bad credentials).
      return { ok: false, error: data.code ? `twilio_${data.code}` : `http_${res.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    return { ok: false, error: `unreachable: ${(e as Error).message}` };
  }
}
