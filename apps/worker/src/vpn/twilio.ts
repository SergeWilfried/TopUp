import { toE164 } from '@topup/core';
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

/** Whether a message could actually be sent. Needs a sender, not just an account. */
export const smsConfigured = (env: Env) =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID));


/**
 * Sends one message.
 *
 * Errors are returned rather than thrown: the caller decides whether a delivery
 * failure should be visible to the customer, and an OTP endpoint has to think
 * about that carefully.
 */
export async function sendSms(env: Env, to: string, body: string): Promise<SmsResult> {
  if (!smsConfigured(env)) return { ok: false, error: 'not_configured' };

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
