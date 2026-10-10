/** How long Tusky may sit in the background before App lock asks again. */
export const LOCK_AFTER_MS = 60_000;

/**
 * Whether coming back to the foreground should lock the app.
 * @param backgroundedAt when the app left the foreground (ms), or null when it never did.
 *
 * A clock that moved backwards locks too: setting the time back must not be a way to stay unlocked.
 */
export function shouldLockOnResume(enabled: boolean, backgroundedAt: number | null, now: number): boolean {
  if (!enabled || backgroundedAt === null) return false;
  const away = now - backgroundedAt;
  return away < 0 || away >= LOCK_AFTER_MS;
}

/**
 * What to call the unlock method, from expo-local-authentication's
 * `AuthenticationType` values (1 fingerprint, 2 facial recognition, 3 iris/Optic ID).
 * Face wins when a phone has more than one; no biometrics means the passcode.
 */
export function lockMethodLabel(types: number[], platform: string): string {
  if (types.includes(2)) return 'Face ID';
  if (types.includes(1)) return platform === 'ios' ? 'Touch ID' : 'fingerprint';
  if (types.includes(3)) return platform === 'ios' ? 'Optic ID' : 'iris';
  return 'passcode';
}

const CANCELLED = new Set(['user_cancel', 'app_cancel', 'system_cancel', 'user_fallback']);
const NOTHING_SET_UP = new Set(['not_enrolled', 'passcode_not_set', 'not_available']);

/**
 * What to tell the person when the unlock prompt did not succeed, from
 * expo-local-authentication's error code. Null when they simply cancelled.
 */
export function unlockFailureMessage(error: string): string | null {
  if (CANCELLED.has(error)) return null;
  if (error === 'authentication_failed') return "That didn't match. Try again.";
  if (error === 'lockout') return 'Too many tries. Wait a moment, then try again.';
  if (NOTHING_SET_UP.has(error)) {
    return 'This phone has no Face ID, fingerprint or passcode set up. Set one up, or sign out.';
  }
  return "Couldn't check it's you. Try again.";
}
