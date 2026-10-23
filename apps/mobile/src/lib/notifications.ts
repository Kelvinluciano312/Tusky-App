// What a notification may open, and who still needs to be asked. Pure, so
// node --test can run it. The Expo calls live in push.ts.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED: RegExp[] = [
  /^\/review$/,
  new RegExp(`^\\/transaction\\/${UUID}$`, 'i'),
  new RegExp(`^\\/bank\\/${UUID}$`, 'i'),
  /^\/paywall$/,
  /^\/plan$/,
  /^\/herd$/,
  /^\/budgets$/,
  /^\/recurring$/,
  /^\/settle$/,
];

/** A path the app is willing to open from a notification. Anything else is ignored. */
export function routeForNotification(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== 'string' || url.includes('//')) return null;
  const path = url.split('?')[0];
  return ALLOWED.some((pattern) => pattern.test(path)) ? path : null;
}

/**
 * The one-time Home card. People who already finished onboarding were never
 * asked; the card is how they hear about it. Onboarding sets prompted_at, and
 * so does dismissing the card. A device that already has a token does not ask.
 */
export function showNotificationPrompt(input: { promptedAt?: string | null; hasToken: boolean }): boolean {
  return !input.promptedAt && !input.hasToken;
}

/** "7 PM". Hours only: the digest and quiet hours are stored as 0–23. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

export function formatThreshold(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export const REVIEW_HOURS = [8, 12, 17, 19, 21] as const;
export const QUIET_STARTS = [21, 22, 23] as const;
export const QUIET_ENDS = [6, 7, 8, 9] as const;
export const LARGE_CENTS = [10_000, 25_000, 50_000, 100_000] as const;
export const REVIEW_THRESHOLDS = [5, 10, 20] as const;

/** Mirrors notification_prefs defaults. A missing row means these. */
export const DEFAULT_NOTIFICATION_PREFS = {
  question_asked: true,
  question_answered: true,
  review_digest: true,
  review_threshold: 10,
  review_hour: 19,
  herd_joined: true,
  settle_nudge: false,
  budget_80: false,
  budget_100: true,
  weekly_recap: true,
  large_transaction: false,
  large_cents: 50_000,
  upcoming_bill: false,
  price_change: true,
  trial_ending: true,
  billing_issue: true,
  quiet_start: 22,
  quiet_end: 8,
  hide_amounts: false,
};
