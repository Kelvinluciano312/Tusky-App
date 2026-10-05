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
