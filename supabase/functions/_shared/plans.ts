import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Plans (Phase 14). The database decides which plan a user is on
 * (`private.effective_plan`, wrapped by `plan_for`); this file only reads the
 * answer and makes the small decisions the Edge Functions share. Every limit is
 * enforced here, on the server, never in the app.
 */
export type PlanId = 'free' | 'trial' | 'tusklet' | 'tusk' | 'tusk_herd';

export type PlanState = {
  plan: PlanId;
  /** Where the plan comes from: my own row, a herd mate's Tusk Herd, my trial, or nothing. */
  source: 'own' | 'herd' | 'trial' | 'free';
  expires_at: string | null;
  max_banks: number;
  history_days: number;
  ai: boolean;
  /** 'herd' pools every live bank in the herd against one limit. */
  scope: 'self' | 'herd';
  /** Live (not archived) banks counted against this plan. */
  banks_used: number;
};

/** The user's plan. Throws on any failed read: an unknown plan must refuse, never allow. */
export async function loadPlan(admin: SupabaseClient, userId: string): Promise<PlanState> {
  const { data, error } = await admin.rpc('plan_for', { p_user: userId }).single();
  if (error || !data) throw new Error(`plan_for failed for ${userId}: ${error?.message ?? 'no row'}`);
  return data as PlanState;
}

export function canAddBank(p: PlanState): boolean {
  return p.banks_used < p.max_banks;
}

/** Past the limit, as after a race between two links. At the limit is fine. */
export function overLimit(p: PlanState): boolean {
  return p.banks_used > p.max_banks;
}

/** Plaid's transactions.days_requested accepts 1..730. */
export function historyDays(p: PlanState): number {
  return Math.min(730, Math.max(1, p.history_days));
}

/** Whether AI decisions may run for banks this user connected. */
export function aiAllowed(p: PlanState): boolean {
  return p.ai;
}

/** The 402 body that tells the app to show the paywall. */
export function planLimitBody(p: PlanState): { error: 'plan_limit'; plan: PlanId; max_banks: number } {
  return { error: 'plan_limit', plan: p.plan, max_banks: p.max_banks };
}
