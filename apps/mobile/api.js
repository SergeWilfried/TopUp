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

/** eSIM profiles the account owns, refreshed from the provider on read. */
export const myEsims = () => request('GET', '/me/esims');

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

/**
 * Which services are switched on in a market.
 *
 * Asked per country because a corridor is turned off one market at a time. The
 * app hides what is off; the worker refuses it regardless, so an older build
 * that never learned about a switch still cannot buy through it.
 */
export const features = (country) =>
  request('GET', `/features?country=${encodeURIComponent(country)}`);

export const esimPlans = (country, lang) =>
  request('GET', `/esim/plans/${encodeURIComponent(country)}?lang=${encodeURIComponent(lang)}`);

/**
 * Reports the handset once per install, and gets back what it can do.
 *
 * Two questions, one round trip. Ours: how much of the base can take an eSIM —
 * unanswerable from anything else we store, and the number that decides
 * whether the corridor is worth building. Theirs: can *this* phone install
 * one, which the eSIM screens need before taking money for a QR code.
 *
 * `installId` is generated locally and tied to nothing: no number, no account,
 * no advertising identifier. Failures are swallowed by the caller — a boot
 * must never depend on this.
 */
export const reportDevice = (payload) => request('POST', '/telemetry/device', payload);

/** VPN locations that are actually installable — active servers only. */
export const vpnServers = () => request('GET', '/servers');

// ── purchase ────────────────────────────────────────────────────────────────
/** Payment options and the converted price for this market. */
export const paymentMethods = (country, productId, amount) =>
  request(
    'GET',
    `/checkout/methods?country=${encodeURIComponent(country)}` +
      (productId ? `&productId=${encodeURIComponent(productId)}` : '') +
      // A free amount is quoted the same way a product is — same fee rule.
      (!productId && amount ? `&amount=${encodeURIComponent(amount)}` : ''),
  );

/**
 * Starts a purchase. The rail is decided by the server from `country`, so the
 * app cannot ask to be charged on one the backend would reject.
 *
 * Resolves to `{ orderId, status, action, url?, quote }` — `action` is
 * 'approve_on_handset' for mobile money or 'redirect' for card rails.
 */
export const startCheckout = ({ productId, amount, network, iccid, country, msisdn, recipientMsisdn, recipientCountry, email, instrument, carrier }) =>
  request('POST', '/checkout', {
    // Either a catalogue line, or a free amount on a named network. `iccid`
    // makes an eSIM purchase a top-up of a profile the customer already has.
    productId, amount, network, iccid, country, msisdn, recipientMsisdn, recipientCountry, email,
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
  // The pause between polls ends early on abort, so STOP WAITING answers at
  // once rather than after whatever is left of the interval.
  const pause = () =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new ApiError(0, 'cancelled'));
      const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, intervalMs);
      const onAbort = () => { clearTimeout(id); reject(new ApiError(0, 'cancelled')); };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  for (;;) {
    if (signal?.aborted) throw new ApiError(0, 'cancelled');
    const order = await orderStatus(orderId);
    if (signal?.aborted) throw new ApiError(0, 'cancelled');
    if (order.status && order.status !== 'pending') return order;
    if (Date.now() >= deadline) throw new ApiError(0, 'timeout');
    await pause();
  }
}

// ── vpn ─────────────────────────────────────────────────────────────────────
/** Issues a WireGuard peer on one server. The config is returned once. */
export const provisionPeer = (serverId) => request('POST', '/me/provision', { serverId });

export const removePeer = (publicKey) =>
  request('DELETE', `/me/peers/${encodeURIComponent(publicKey)}`);
