import { nativeIntentPath } from '@/lib/recovery';

/**
 * Rewrites incoming universal links before Expo Router treats the path as a
 * screen. `/tusky/reset` is not a route (recovery is applied from the original
 * URL in the root layout). `/tusky/plaid-oauth` is left alone: the Plaid SDK
 * reads that return itself, and rewriting it would drop the redirect it waits for.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return nativeIntentPath(path);
  } catch {
    return path;
  }
}
