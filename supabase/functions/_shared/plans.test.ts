import { assertEquals, assertRejects } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { aiAllowed, canAddBank, historyDays, loadPlan, overLimit, planLimitBody, type PlanState } from './plans.ts';

const plan = (over: Partial<PlanState> = {}): PlanState => ({
  plan: 'tusklet', source: 'own', expires_at: null, max_banks: 3, history_days: 365, ai: true, scope: 'self', banks_used: 0,
  ...over,
});

Deno.test('canAddBank: below the limit yes, at it no', () => {
  assertEquals(canAddBank(plan({ banks_used: 2 })), true);
  assertEquals(canAddBank(plan({ banks_used: 3 })), false);
});

Deno.test('canAddBank: free has no banks at all', () => {
  assertEquals(canAddBank(plan({ plan: 'free', max_banks: 0, banks_used: 0 })), false);
});

Deno.test('overLimit: only past the limit, never at it', () => {
  assertEquals(overLimit(plan({ banks_used: 3 })), false);
  assertEquals(overLimit(plan({ banks_used: 4 })), true);
});

Deno.test('historyDays stays inside what Plaid accepts', () => {
  assertEquals(historyDays(plan({ history_days: 365 })), 365);
  assertEquals(historyDays(plan({ history_days: 0 })), 1);
  assertEquals(historyDays(plan({ history_days: 9999 })), 730);
});

Deno.test('aiAllowed follows the plan', () => {
  assertEquals(aiAllowed(plan({ ai: true })), true);
  assertEquals(aiAllowed(plan({ plan: 'free', ai: false })), false);
});

Deno.test('planLimitBody names the plan and its limit', () => {
  assertEquals(planLimitBody(plan({ plan: 'trial', max_banks: 2 })), { error: 'plan_limit', plan: 'trial', max_banks: 2 });
});

const rpcAdmin = (resp: { data?: unknown; error?: unknown }, seen: unknown[] = []) =>
  ({
    rpc: (fn: string, args: unknown) => {
      seen.push([fn, args]);
      return { single: () => Promise.resolve(resp) };
    },
  }) as unknown as SupabaseClient;

Deno.test('loadPlan asks plan_for about that user', async () => {
  const seen: unknown[] = [];
  const got = await loadPlan(rpcAdmin({ data: plan() }, seen), 'user-1');
  assertEquals(got.plan, 'tusklet');
  assertEquals(seen, [['plan_for', { p_user: 'user-1' }]]);
});

Deno.test('loadPlan throws on a failed read, so callers refuse rather than allow', async () => {
  await assertRejects(() => loadPlan(rpcAdmin({ data: null, error: { message: 'boom' } }), 'user-1'));
  await assertRejects(() => loadPlan(rpcAdmin({ data: null }), 'user-1'));
});
