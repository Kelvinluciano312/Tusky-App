// Two-step sign-in (Phase 16e), the Edge Function side. The database refuses
// a password-only session through private.my_herd_id(); functions run as the
// service role, so they must apply the same rule themselves. Pure, so it is
// tested apart from Deno.serve.

/** The `amr` claim of an access token the caller has already validated. */
export function amrOfToken(token: string): unknown {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return (JSON.parse(json) as { amr?: unknown })?.amr ?? null;
  } catch {
    return null;
  }
}

/** Did this session prove an emailed code? Anything unreadable counts as no. */
export function hasOtpProof(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((e) => typeof e === 'object' && e !== null && (e as { method?: unknown }).method === 'otp');
}

/** True when the user turned two-step on and this session has not proved a code. */
export function secondStepRequired(twoFactor: boolean | null | undefined, amr: unknown): boolean {
  return twoFactor === true && !hasOtpProof(amr);
}
