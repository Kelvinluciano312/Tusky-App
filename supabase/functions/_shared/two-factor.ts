// Two-step sign-in (Phase 16e), the Edge Function side. A session is verified
// when `two_factor_sessions` has a row for its `session_id`, written only by the
// `two-factor` function after it checked an emailed code FROM a session that
// already proved the password. The JWT's `amr` cannot be the proof: verifyOtp
// makes its own session with amr [otp], which a mailbox alone can obtain.
// Everything here is pure, so it is tested apart from Deno.serve.

/**
 * Code attempts allowed within the window, then 429 `too_many_attempts`: per
 * session, and per user across all sessions (a fresh sign-in is not a fresh
 * budget). Passed to `take_two_factor_attempt`, which reserves an attempt
 * atomically before the code is checked.
 */
export const MAX_WRONG_CODES = 5;
export const MAX_WRONG_CODES_PER_USER = 10;
export const WRONG_CODE_WINDOW_MINUTES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The claims of an access token the caller has already validated (getAuthedUser). */
export function claimsOfToken(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The session the token belongs to; null when absent or not a uuid. */
export function sessionIdOfClaims(claims: Record<string, unknown> | null): string | null {
  const id = claims?.session_id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/** Did this session sign in with a password? Anything unreadable counts as no. */
export function hasPasswordMethod(amr: unknown): boolean {
  return (
    Array.isArray(amr) &&
    amr.some((e) => typeof e === 'object' && e !== null && (e as { method?: unknown }).method === 'password')
  );
}

/**
 * May this session be marked verified? Only one that proved the password:
 * an otp- or recovery-created session never can, which is the whole point.
 */
export function markableSession(claims: Record<string, unknown> | null): { sessionId: string } | null {
  const sessionId = sessionIdOfClaims(claims);
  if (!sessionId || !hasPasswordMethod(claims?.amr)) return null;
  return { sessionId };
}

/**
 * The Auth error codes verifyOtp answers for a code that is wrong or expired.
 * Not yet confirmed against the hosted dev project (expected: 403 otp_expired).
 * A captcha or provider error has another code and must not burn an attempt.
 */
const WRONG_CODE_ERRORS = new Set(['otp_expired', 'invalid_credentials']);

/** What a failed verifyOtp means. 429 is the vendor's own limit; a known wrong-or-expired code is a wrong code; the rest is not the user's fault. */
export function verifyFailure(
  status: number | undefined,
  code?: string,
): 'wrong_code' | 'too_many_attempts' | 'unavailable' {
  if (status === 429) return 'too_many_attempts';
  if (typeof status === 'number' && status >= 400 && status < 500 && code !== undefined && WRONG_CODE_ERRORS.has(code)) {
    return 'wrong_code';
  }
  return 'unavailable';
}

/** The id `take_two_factor_attempt` returns for a reserved attempt; null (or anything unreadable) means refused. */
export function reservedAttempt(rpcData: unknown): number | null {
  const n = typeof rpcData === 'string' ? Number(rpcData) : rpcData;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/** True when the user turned two-step on and this session has no verified row. */
export function secondStepRequired(twoFactor: boolean | null | undefined, sessionVerified: boolean): boolean {
  return twoFactor === true && !sessionVerified;
}
