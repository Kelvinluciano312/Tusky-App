// Password reset links and the words the screens use for them. Pure: the
// Supabase calls live in recovery-session.ts and the screens. The client stays
// on the implicit flow (the default), because two-step sign-in emails a code
// with signInWithOtp and a global switch to PKCE would attach a code challenge
// to that request. iOS often drops the fragment on an implicit redirect, so the
// recovery email should also carry a token_hash deep link (see the PR notes).

/** Where `resetPasswordForEmail` sends the person. Allow-list this exactly. */
export const PASSWORD_RESET_REDIRECT = 'tusky://reset-password';

export type RecoveryLink =
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'code'; code: string }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'otp'; token: string };

function paramsOf(url: URL): URLSearchParams {
  const query = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const merged = new URLSearchParams(query);
  hash.forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  return merged;
}

/** A tusky://reset-password link, or null when the URL is some other deep link. */
export function parseRecoveryUrl(raw: string): RecoveryLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'tusky:') return null;
  const route = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, '');
  const params = paramsOf(url);
  const type = params.get('type');
  if (type && type !== 'recovery') return null;
  if (route !== 'reset-password' && type !== 'recovery') return null;

  const tokenHash = params.get('token_hash')?.trim();
  if (tokenHash) return { kind: 'token_hash', tokenHash };
  const code = params.get('code')?.trim();
  if (code) return { kind: 'code', code };
  const accessToken = params.get('access_token')?.trim();
  const refreshToken = params.get('refresh_token')?.trim();
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
  const token = params.get('token')?.trim();
  if (token) return { kind: 'otp', token };
  return null;
}

type AuthError = { status?: number; message?: string } | null;

function rateLimited(error: { status?: number; message?: string }): boolean {
  return error.status === 429 || /rate limit|security purposes|too many/i.test(error.message ?? '');
}

/**
 * Null means "say we sent it". An unknown address is the same answer, so the
 * screen does not reveal which emails have an account.
 */
export function resetRequestMessage(error: AuthError): string | null {
  if (!error) return null;
  if (/user not found|not registered/i.test(error.message ?? '')) return null;
  if (rateLimited(error)) return 'Too many reset emails. Wait a minute and try again.';
  if (/invalid email|unable to validate email|validate email/i.test(error.message ?? '')) {
    return 'Enter the email you use for Tusky.';
  }
  return 'We could not send the reset email. Check your connection and try again.';
}

/** Null when the link or code created a session. */
export function recoveryExchangeMessage(error: AuthError): string | null {
  if (!error) return null;
  if (rateLimited(error)) return 'Too many attempts. Wait a minute and try again.';
  if (/code verifier/i.test(error.message ?? '')) {
    return 'Open the link on the phone where you asked for the reset, or enter the code from the email.';
  }
  if (/expired|invalid|otp|token/i.test(error.message ?? '')) {
    return 'That code or link is not right or has expired. Request a new one.';
  }
  return 'We could not open that reset link. Request a new one.';
}

export function passwordUpdateMessage(error: { status?: number; message?: string }): string {
  if (rateLimited(error)) return 'Too many attempts. Wait a minute and try again.';
  if (/different from the old password|should be different/i.test(error.message ?? '')) {
    return 'Choose a password you have not used before.';
  }
  if (/session|expired|invalid/i.test(error.message ?? '')) {
    return 'This reset link has expired. Request a new one from the sign-in screen.';
  }
  return 'Could not save the new password. Check your connection and try again.';
}
