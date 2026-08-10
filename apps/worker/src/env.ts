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
