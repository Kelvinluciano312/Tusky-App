// When the cached server data stops being the signed-in user's (Phase 16 review).
// Most query keys are not user-scoped, so any sign-out or user switch, including
// one the app did not start (a session the server ended), must empty the cache.

/** True when the user went away or changed; a first sign-in, a refresh or no change keeps the cache. */
export function shouldClearCache(prevId: string | null | undefined, nextId: string | null | undefined): boolean {
  return !!prevId && prevId !== (nextId ?? null);
}
