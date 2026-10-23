// Crash reports leave the phone only when EXPO_PUBLIC_SENTRY_DSN is set.
// An unset public env var arrives as '', which sentryDsn treats as off, so
// this file's Sentry.init never runs and nothing is sent.

import * as Sentry from '@sentry/react-native';

import { reportCrash, sentryDsn } from '@/lib/crash-reporting';

const dsn = sentryDsn(process.env.EXPO_PUBLIC_SENTRY_DSN);
let started = false;

/** Starts Sentry when a DSN is configured. No-op otherwise, including a second call. */
export function initCrashReporting(): boolean {
  if (!dsn || started) return false;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  started = true;
  return true;
}

/** A render error. Swallowed if Sentry itself throws, so the fallback can still show. */
export function reportRenderedError(error: unknown): void {
  reportCrash(dsn, error, (value) => {
    Sentry.captureException(value);
  });
}
