export type Env = {
  /** Control-plane store: users, sessions, servers, peers, billing events. */
  DB: D1Database;
  ENVIRONMENT: string;
  DEVICE_LIMIT: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY?: string;
  /** Master key the per-server agent tokens are derived from. Never stored in D1. */
  AGENT_SIGNING_KEY?: string;
  // LAfricaMobile authenticates with login+password as *query parameters*, so
  // these end up in the request URL. Nothing here may log a built URL.
  LAFRICAMOBILE_LOGIN?: string;
  LAFRICAMOBILE_PASSWORD?: string;
  LAFRICAMOBILE_BASE_URL?: string;
  // SMS login codes. Either TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID is
  // required; the service handles sender selection and per-country compliance.
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  /** Last-resort dialling code when a client sends no country. */
  SMS_DEFAULT_COUNTRY?: string;
  /** Overridden in tests to point at a local double. */
  TWILIO_BASE_URL?: string;
  /**
   * Twilio Verify service (VA…). When set, Twilio owns the whole code
   * lifecycle for SMS and nothing is stored here.
   */
  TWILIO_VERIFY_SERVICE_SID?: string;
  TWILIO_VERIFY_BASE_URL?: string;
  /**
   * '1' on the deployed worker only. Live SMS is blocked without it, because
   * ENVIRONMENT cannot distinguish a local run from the real one.
   */
  ALLOW_LIVE_SMS?: string;

  /**
   * Merchant codes for dial-to-pay collection, as JSON:
   *   {"BF":{"Orange":"123456","Moov":"654321"}}
   * A wallet with no code simply is not offered the dial rail.
   */
  MERCHANT_CODES?: string;
  /** Service fee percent on airtime and data. Defaults to 2. */
  SERVICE_FEE_PCT?: string;
  /** '1' stands a fake distributor in until real credentials work. */
  MOCK_DELIVERY?: string;
  /** Shared secret the collector device signs its reports with. */
  COLLECTOR_TOKEN?: string;

  // Checkout providers.
  PUBLIC_BASE_URL?: string;
  PAWAPAY_BASE_URL?: string;
  PAWAPAY_API_TOKEN: string;
  PAYSTACK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
};

export const now = () => Date.now();
export const days = (n: number) => n * 86_400_000;

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const randHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);

export const sha256 = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

/**
 * Comparison whose duration does not depend on where the first difference is.
 * Used for anything an attacker can submit repeatedly: OTP hashes, webhook
 * signatures.
 */
export const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 254;
