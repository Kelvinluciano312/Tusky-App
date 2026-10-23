// Whether crash reports leave the phone. Pure: the Sentry call lives in sentry.ts.
// An unset EXPO_PUBLIC_ var arrives as '', so blank is the same as missing.

/** The DSN to init with, or null when reporting is off. */
export function sentryDsn(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Forwards a render error to the reporter only when a DSN is configured.
 * A failure inside the reporter stays here: the fallback still has to render.
 */
export function reportCrash(
  dsn: string | null,
  error: unknown,
  capture: (error: unknown) => void,
): boolean {
  if (!dsn) return false;
  try {
    capture(error);
    return true;
  } catch {
    return false;
  }
}
