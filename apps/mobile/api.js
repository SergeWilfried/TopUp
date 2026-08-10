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

/** Sends a six-digit code by SMS. */
export const requestCode = (msisdn) => request('POST', '/auth/otp', { msisdn });

/** Exchanges the code for a session and remembers it. */
export async function verifyCode(msisdn, code) {
  const result = await request('POST', '/auth/verify', { msisdn, code });
  cachedToken = result.token;
  await AsyncStorage.setItem(TOKEN_KEY, result.token).catch(() => {});
  return result.user;
}

export async function signOut() {
  await request('POST', '/auth/signout', {}).catch(() => {});
  await clearSession();
}

export const me = () => request('GET', '/me');

/** Payment options and the converted price for this market. */
export const paymentMethods = (country, productId) =>
  request('GET', `/checkout/methods?country=${encodeURIComponent(country)}${productId ? `&productId=${encodeURIComponent(productId)}` : ''}`);
