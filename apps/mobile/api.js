import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Client for the TOPUP worker.
 *
 * The app signs in with a phone number; the console and VPN recovery use an
 * email. Both hit the same endpoints and resolve to one account.
 */

// Simulator and device reach the dev worker differently; override per build.
const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

const TOKEN_KEY = 'topup.session';

export class ApiError extends Error {
  constructor(status, code, field) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

let cachedToken = null;

export const loadSession = async () => {
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  return cachedToken;
};

export const clearSession = async () => {
  cachedToken = null;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
};

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cachedToken ? { authorization: `Bearer ${cachedToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // A dead network is not the same as a rejected request; say so.
    throw new ApiError(0, 'network_error');
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) await clearSession();
  if (!res.ok) throw new ApiError(res.status, data.error ?? `http_${res.status}`, data.field);
  return data;
}

/**
 * Sends a six-digit code by SMS.
 *
 * `country` matters: accounts are keyed by a national number, so the server
 * needs the dialling code to reach the handset. Without it a +226 number would
 * be rebuilt with the home market's prefix and the code would go to a stranger.
 */
export const requestCode = (msisdn, country) =>
  request('POST', '/auth/otp', { msisdn, country });

/**
 * Exchanges the code for a session and remembers it.
 *
 * `country` is required here for the same reason it is on the request: identity
 * is the canonical E.164 form, and a national number cannot be resolved to it
 * without knowing the market. Omitting it made every verification fail with
 * msisdn_invalid.
 */
export async function verifyCode(msisdn, code, country) {
  const result = await request('POST', '/auth/verify', { msisdn, code, country });
  cachedToken = result.token;
  await AsyncStorage.setItem(TOKEN_KEY, result.token).catch(() => {});
  return result.user;
}

export async function signOut() {
  await request('POST', '/auth/signout', {}).catch(() => {});
  await clearSession();
}

export const me = () => request('GET', '/me');

/** Purchases and loyalty balance for the signed-in account. */
export const myOrders = (lang) => request('GET', `/me/orders?lang=${encodeURIComponent(lang || 'en')}`);

// ── catalogue ───────────────────────────────────────────────────────────────
/**
 * The sellable catalogue, already translated server-side.
 *
 * Prices and terms have to come from here rather than a bundled copy: the
 * console can change or disable a product at any time, and checkout re-reads
 * the price from the database anyway, so a stale local list would quote one
 * number and charge another.
 */
export const catalogue = (lang) => request('GET', `/catalogue?lang=${encodeURIComponent(lang)}`);

export const esimPlans = (country, lang) =>
  request('GET', `/esim/plans/${encodeURIComponent(country)}?lang=${encodeURIComponent(lang)}`);

/** VPN locations that are actually installable — active servers only. */
export const vpnServers = () => request('GET', '/servers');

// ── purchase ────────────────────────────────────────────────────────────────
/** Payment options and the converted price for this market. */
export const paymentMethods = (country, productId) =>
  request(
    'GET',
    `/checkout/methods?country=${encodeURIComponent(country)}` +
      (productId ? `&productId=${encodeURIComponent(productId)}` : ''),
  );

/**
 * Starts a purchase. The rail is decided by the server from `country`, so the
 * app cannot ask to be charged on one the backend would reject.
 *
 * Resolves to `{ orderId, status, action, url?, quote }` — `action` is
 * 'approve_on_handset' for mobile money or 'redirect' for card rails.
 */
export const startCheckout = ({ productId, country, msisdn, recipientMsisdn, recipientCountry, email, instrument, carrier }) =>
  request('POST', '/checkout', {
    productId, country, msisdn, recipientMsisdn, recipientCountry, email,
    // 'dial' collects straight into our merchant wallet — no processing fee and
    // no provider call; the customer's handset is the rail.
    instrument, carrier,
  });

/** Authoritative order state. The app polls this rather than trusting a callback. */
export const orderStatus = (orderId) => request('GET', `/checkout/${encodeURIComponent(orderId)}`);

/**
 * Polls until the order leaves `pending`, or the caller gives up.
 *
 * Mobile money resolves when the customer approves on their handset, which can
 * take a while, so this is deliberately patient and cancellable.
 */
export async function waitForOrder(orderId, { intervalMs = 2500, timeoutMs = 180000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new ApiError(0, 'cancelled');
    const order = await orderStatus(orderId);
    if (order.status && order.status !== 'pending') return order;
    if (Date.now() >= deadline) throw new ApiError(0, 'timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── vpn ─────────────────────────────────────────────────────────────────────
/** Issues a WireGuard peer on one server. The config is returned once. */
export const provisionPeer = (serverId) => request('POST', '/me/provision', { serverId });

export const removePeer = (publicKey) =>
  request('DELETE', `/me/peers/${encodeURIComponent(publicKey)}`);
