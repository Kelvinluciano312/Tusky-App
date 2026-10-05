// Two-step sign-in (Phase 16e), the app side. The database is what enforces it
// (private.my_herd_id gives a password-only session no herd); this only decides
// when to show the code screen. Pure, so it is tested apart from the router.

/** Did this session prove an emailed code? `amr` is the JWT claim: [{ method, timestamp }]. */
export function hasOtpProof(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((e) => typeof e === 'object' && e !== null && (e as { method?: unknown }).method === 'otp');
}

/**
 * The code screen is needed when the user turned two-step on and this session
 * has not proved a code. An unknown profile (still loading, or the read
 * failed) never asks: the database refuses a password-only session anyway.
 */
export function needsSecondStep(profile: { two_factor: boolean | null } | null, amr: unknown): boolean {
  return profile?.two_factor === true && !hasOtpProof(amr);
}

/** The `amr` claim of an access token; null when it cannot be read. */
export function amrOfAccessToken(token: string | null | undefined): unknown {
  try {
    const payload = token?.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { amr?: unknown } | null;
    return claims?.amr ?? null;
  } catch {
    return null;
  }
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

/** An Edge Function's 403 for a password-only session on a two-step account (`requireSecondStep`). */
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
