import { ApiError, apiSend } from './api';

const STORE = 'topup.admin.token';

export type Session = { token: string; email: string | null; isStaff: boolean };

/**
 * Console session.
 *
 * Held in localStorage rather than memory so a refresh does not log the
 * operator out mid-task. The token is a bearer credential, so this is only as
 * safe as the console's origin — anything script-injectable here can steal it.
 */
export const readToken = () => localStorage.getItem(STORE);

export const clearToken = () => localStorage.removeItem(STORE);

export async function requestCode(email: string) {
  await apiSend('POST', '/auth/otp', { email });
}

export async function verifyCode(email: string, code: string): Promise<Session> {
  const result = await apiSend<{
    token: string;
    user: { email: string | null; isStaff: boolean };
  }>('POST', '/auth/verify', { email, code });

  // A valid sign-in that is not staff must not look like a broken login.
  if (!result.user.isStaff) throw new ApiError(403, 'not_staff');

  localStorage.setItem(STORE, result.token);
  return { token: result.token, email: result.user.email, isStaff: true };
}

export async function signOut() {
  await apiSend('POST', '/auth/signout', {}).catch(() => {});
  clearToken();
}
