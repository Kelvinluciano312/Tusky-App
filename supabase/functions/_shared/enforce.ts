import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { disconnectItem } from './connections.ts';
import { loadPlan, overLimit, pastLimit, type PlanState } from './plans.ts';

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

export type EnforceReport = {
  user_id: string;
  plan: string;
  scope: 'self' | 'herd';
  archive: string[];
  overLimitSince: string | null;
  results: Record<string, string>;
};

/**
 * Every user with a live bank or an open window, judged once (a herd pool once
 * per herd). Never throws for one user: a failure is logged and the rest go on.
 * With dryRun, it decides and reports but changes nothing.
 */
export async function runEnforcer(
  admin: SupabaseClient,
  plaid: PlaidApi,
  now: Date,
  dryRun: boolean,
): Promise<EnforceReport[]> {
  const { data: live, error: liveError } = await admin
    .from('plaid_items').select('user_id, herd_id').in('status', ['active', 'login_required']);
  if (liveError) throw liveError;
  const { data: flagged, error: flaggedError } = await admin
    .from('subscriptions').select('user_id').not('over_limit_since', 'is', null);
  if (flaggedError) throw flaggedError;

  const users = [...new Set([...(live ?? []), ...(flagged ?? [])].map((r) => r.user_id as string))];
  const herdsDone = new Set<string>();
  const reports: EnforceReport[] = [];

  for (const userId of users) {
    try {
      const plan = await loadPlan(admin, userId);
      const { data: member, error: memberError } = await admin
        .from('herd_members').select('herd_id').eq('user_id', userId).single();
      if (memberError) throw memberError;
      const herdId = member.herd_id as string;
      if (plan.scope === 'herd') {
        if (herdsDone.has(herdId)) continue;
        herdsDone.add(herdId);
      }

      const scoped = admin.from('plaid_items').select('id, created_at, status').neq('status', 'archived');
      const { data: items, error: itemsError } = await (plan.scope === 'herd'
        ? scoped.eq('herd_id', herdId)
        : scoped.eq('user_id', userId));
      if (itemsError) throw itemsError;

      // The window lives on every covered member's row: the user's own, or the herd's.
      let covered = [userId];
      if (plan.scope === 'herd') {
        const { data: mates, error: matesError } = await admin
          .from('herd_members').select('user_id').eq('herd_id', herdId);
        if (matesError) throw matesError;
        covered = (mates ?? []).map((m) => m.user_id as string);
      }
      const { data: subs, error: subsError } = await admin
        .from('subscriptions').select('over_limit_since').in('user_id', covered).not('over_limit_since', 'is', null)
        .order('over_limit_since').limit(1);
      if (subsError) throw subsError;
      const overLimitSince = (subs?.[0]?.over_limit_since as string | undefined) ?? null;

      const verdict = decide({ plan, items: items ?? [], overLimitSince, now });
      const results: Record<string, string> = {};

      if (!dryRun) {
        for (const id of verdict.archive) {
          const it = (items ?? []).find((x) => x.id === id)!;
          try {
            results[id] = await disconnectItem(admin, plaid, { id, status: it.status }, 'archive');
          } catch (err) {
            results[id] = `error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        if (verdict.overLimitSince !== overLimitSince) {
          const { error } = await admin
            .from('subscriptions').update({ over_limit_since: verdict.overLimitSince }).in('user_id', covered);
          if (error) throw error;
        }
      }
      reports.push({ user_id: userId, plan: plan.plan, scope: plan.scope, ...verdict, results });
    } catch (err) {
      console.error(`plan-enforcer: user ${userId} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return reports;
}
