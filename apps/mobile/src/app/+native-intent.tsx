import { isPlaidOAuthReturn } from '@/lib/deep-links';

/** A falsy return makes the router ignore the URL, so Plaid's OAuth return does not navigate. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return isPlaidOAuthReturn(path) ? null : path;
  } catch {
    return path;
  }
}
