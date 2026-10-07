// Two-step sign-in (Phase 16e), the app side. The database is what enforces it
// (private.my_herd_id gives an unverified session no herd); this only decides
// when to show the code screen. Pure, so it is tested apart from the router.

/**
 * The code screen is needed when the user turned two-step on and the server has
 * not verified this session. "Verified" is `my_second_step_done` (a row for the
 * session in `two_factor_sessions`), never the JWT's `amr`, which a mailbox
 * alone can obtain. An unknown profile (still loading, or the read failed)
 * never asks: the database refuses an unverified session anyway.
 */
export function needsSecondStep(
  profile: { two_factor: boolean | null } | null,
  secondStepDone: boolean | null | undefined,
): boolean {
  return profile?.two_factor === true && secondStepDone !== true;
}

/**
 * Length of the emailed code: Auth -> Email OTP Length on the Supabase project
 * (the hosted dev project sends 8, `config.toml`'s local default is 6). The
 * field submits by itself at this many digits; `MIN_CODE_LENGTH` is what the
 * Verify button accepts, so a project set to 6 still works by tapping.
 */
export const CODE_LENGTH = 8;
export const MIN_CODE_LENGTH = 6;
/** Seconds before a code can be asked for again. */
export const RESEND_SECONDS = 60;

/** What the user typed or pasted, cut down to the digits of a code (a pasted "123 456" works). */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** Long enough to try: the Verify button's rule. */
export function codeComplete(code: string): boolean {
  return code.length >= MIN_CODE_LENGTH;
}

/** The whole code: the field submits by itself at this point. */
export function codeFull(code: string): boolean {
  return code.length === CODE_LENGTH;
}

/** Whole seconds left before a resend is allowed; 0 when it is. `sentAt` and `now` are epoch ms. */
export function resendSecondsLeft(sentAt: number, now: number, cooldown: number = RESEND_SECONDS): number {
  return Math.min(cooldown, Math.max(0, Math.ceil(cooldown - (now - sentAt) / 1000)));
}

/** The resend button's text: a live countdown, then plain. */
export function resendLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Resend code';
  const m = Math.floor(secondsLeft / 60);
  const s = String(secondsLeft % 60).padStart(2, '0');
  return `Resend code in ${m}:${s}`;
}

/** What the server calls a code that is wrong, expired or already used; the screen words it once. */
export const WRONG_CODE_MESSAGE = 'That code is not right or has expired.';

/** What a person reads when the `two-factor` function refuses; `code` is its `error` field. */
export function codeFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'wrong_code':
      return WRONG_CODE_MESSAGE;
    case 'too_many_attempts':
      return 'Too many wrong codes. Wait a few minutes, then ask for a new one.';
    case 'password_session_required':
      return 'Sign in with your password first, then enter the code. Tap Sign out and start again.';
    default:
      return 'We could not check the code. Check your connection and try again.';
  }
}

export const RATE_LIMITED_MESSAGE = 'A code was sent a moment ago. Wait a minute, then ask for another.';
export const SEND_FAILED_MESSAGE = 'We could not send a code. Check your connection and try again.';

/**
 * What the screen shows when asking for a code failed. `sent` is true when a
 * code did go out a moment ago (the per-address rate limit), so the resend
 * countdown stays; false for a real failure, which must not start one.
 */
export function sendFailure(error: { status?: number; message?: string }): { message: string; sent: boolean } {
  if (error.status === 429 || /rate limit|security purposes/i.test(error.message ?? '')) {
    return { message: RATE_LIMITED_MESSAGE, sent: true };
  }
  return { message: SEND_FAILED_MESSAGE, sent: false };
}

/** An Edge Function's 403 for an unverified session on a two-step account (`requireSecondStep`). */
export const TWO_FACTOR_REQUIRED = 'two_factor_required';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to "a function said the second step is missing"; returns the unsubscribe. */
export function onTwoFactorRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called wherever a function's error body is read (`readFunctionError`). The
 * root layout listens and re-reads the first-run state, so the gate shows the
 * code screen instead of every call failing in place.
 */
export function notifyTwoFactorRequired(): void {
  for (const listener of [...listeners]) listener();
}
