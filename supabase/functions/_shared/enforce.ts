import { overLimit, pastLimit, type PlanState } from './plans.ts';

/**
 * When a plan ends or shrinks (Phase 14b). The daily plan-enforcer asks decide()
 * what to do for each user (or herd pool) and carries it out. Pure: the I/O is
 * runEnforcer, below.
 */

/** Days a user has to choose which banks to keep after dropping to a smaller plan. */
export const CHOOSE_DAYS = 7;

export type EnforceItem = { id: string; created_at: string; status: string };

export function decide(i: {
  plan: PlanState;
  items: EnforceItem[];
  overLimitSince: string | null;
  now: Date;
}): { archive: string[]; overLimitSince: string | null } {
  if (!overLimit(i.plan)) return { archive: [], overLimitSince: null };
  // Free keeps no live bank: the trial is over, so every bank goes today.
  if (i.plan.max_banks === 0) return { archive: i.items.map((x) => x.id), overLimitSince: null };
  const since = i.overLimitSince ?? i.now.toISOString();
  const due = i.now.getTime() - Date.parse(since) >= CHOOSE_DAYS * 86_400_000;
  return {
    archive: due ? i.items.filter((x) => pastLimit(i.items, x.id, i.plan.max_banks)).map((x) => x.id) : [],
    overLimitSince: since,
  };
}

/** Constant-time comparison of the cron secret. No configured secret means no access. */
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let k = 0; k < expected.length; k++) diff |= given.charCodeAt(k) ^ expected.charCodeAt(k);
  return diff === 0;
}
