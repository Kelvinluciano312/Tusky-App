# Phase 14a — Plans and Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a plan (a 30-day trial at signup, comped Tusk for everyone who exists today), and enforce each plan's bank limit, history depth and AI access on the server.

**Architecture:** Two tables (`plans`, `subscriptions`) and one resolver, `private.effective_plan`, which picks the best of the user's own live row, a herd mate's live `tusk_herd`, and `free`. `public.plan_for(user)` (service role only) and `public.my_plan()` (the signed-in user) wrap it with the plan's limits and the bank count. Edge Functions read `plan_for` through a small `_shared/plans.ts` and decide with pure helpers. No store integration: rows are set by hand to act out each plan.

**Tech Stack:** Postgres (Supabase migrations, RLS), Deno Edge Functions (`npm:` imports, `jsr:@std/assert` tests), Expo app (`node --test` pure tests).

**Spec:** `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md` (sections "Plans and who gets what" and "Enforcing the limits"; milestone 14a).

## Global Constraints

- Plans and limits, seeded exactly: `free` 0 banks / 0 days / no AI / self; `trial` 2 / 730 / AI / self; `tusklet` 3 / 365 / AI / self; `tusk` 10 / 730 / AI / self; `tusk_herd` 15 / 730 / AI / herd. Rank: free < trial < tusklet < tusk < tusk_herd.
- The trial is 30 days from signup, store `trial`, no card.
- Existing users get `('tusk', store 'comp')` with no expiry, so nobody loses a bank.
- A live bank is a `plaid_items` row with `status <> 'archived'`. It counts against the plan of `plaid_items.user_id` (the connector); under `tusk_herd` every live bank in the herd counts against one pool.
- Reconnecting (Link update mode, `item_id` in the body) is never a new bank and is never refused.
- Every limit is enforced in an Edge Function. The app only shows what the server decided.
- Clients never write `plans` or `subscriptions`. `plan_for` is executable by `service_role` only.
- Refusals are `402 { error: 'plan_limit', plan, max_banks }`.
- `transactions.days_requested` comes from the plan's `history_days`, clamped to Plaid's 1–730.
- Production: nothing in this plan touches `awiwcgrisyzimzxgddxu`. Its push waits on Pedro.
- The CLI runs as `npx -y supabase@2.118.0 …` and stays linked to dev (`ifibrsgqdibcomzxencf`).

## Review Focus

1. **A plan read that fails must refuse, not wave through.** link-token and exchange-token return 500 when `plan_for` errors; `jevEnabled` returns false. (Task 3 unit test for `loadPlan` throwing; Task 4 code review.)
2. **Reconnect at or over the limit** (a downgraded user repairing a broken bank) must still open Link. The check lives only in the new-bank branch. (Task 4, Step 6 live check with `item_id`.)
3. **A herd mate's `tusk_herd` stops covering you the moment you leave the herd**, and an expired or `expired`-status row never counts, while `grace` does. (Task 1, `scripts/plan-check.sql` cases.)
4. **Two banks linked at once past a pre-check.** exchange-token recounts after recording the Item and removes the extra one at Plaid. (Task 4 code; `overLimit` unit-tested in Task 3.)
5. **Archived banks never count**, so a lapsed user who reconnects is not blocked by history they kept. (Task 1, plan-check case.)

---

### Task 1: Plans, subscriptions and the resolver (database)

**Files:**
- Create: `scripts/plan-check.sql`
- Create: `supabase/migrations/20261008120000_phase14a_plans.sql`

**Interfaces:**
- Produces: tables `public.plans(id text pk, rank int, max_banks int, history_days int, ai bool, scope text)` and `public.subscriptions(user_id uuid pk, plan text, store text, status text, expires_at timestamptz, over_limit_since timestamptz, updated_at timestamptz)`; `private.effective_plan(p_user uuid) returns table(plan text, source text, expires_at timestamptz)`; `public.plan_for(p_user uuid) returns table(plan text, source text, expires_at timestamptz, max_banks int, history_days int, ai boolean, scope text, banks_used int)`; `public.my_plan()` with the same columns. `source` is one of `own | herd | trial | free`.

- [ ] **Step 1: Confirm the CLI is linked to dev**

Run: `cat supabase/.temp/project-ref`
Expected: `ifibrsgqdibcomzxencf`. Stop if it is anything else.

- [ ] **Step 2: Write the failing check**

Create `scripts/plan-check.sql`. Like `payer-carry-check.sql`, it always ends in `RAISE`, so every change rolls back and the result is in the error text.

```sql
-- Proves plan resolution (Phase 14a): private.effective_plan and public.plan_for, against real
-- dev rows, with Kel Test joined to the test user's herd. Always ends in RAISE, so every change
-- rolls back; the verdict is in the error text.
--
-- Dev only:  npx -y supabase@2.118.0 db query --linked -f scripts/plan-check.sql
-- Expect:    PLAN_CHECK all PASS
do $$
declare
  me  uuid := 'ccbd42ef-cba6-4f05-a100-a83a727255b2';
  kel uuid := '706f7db5-e7e2-4024-bfe3-de3e23954ed2';
  h uuid; kel_home uuid;
  out text := ''; bad int := 0;
  got record;
  live_mine int; live_herd int;
  new_user uuid := gen_random_uuid();
begin
  select herd_id into h from public.herd_members where user_id = me;
  select herd_id into kel_home from public.herd_members where user_id = kel;
  select count(*) into live_mine from public.plaid_items where user_id = me and status <> 'archived';
  select count(*) into live_herd from public.plaid_items where herd_id = h and status <> 'archived';

  -- 1. The migration comped everyone who existed: Tusk, own, no expiry.
  select * into got from public.plan_for(me);
  if got.plan = 'tusk' and got.source = 'own' and got.expires_at is null and got.max_banks = 10
     and got.banks_used = live_mine then out := out || 'comp ok; '
  else bad := bad + 1; out := out || format('comp BAD %s; ', row_to_json(got)); end if;

  -- 2. An active trial is the trial.
  update public.subscriptions set plan = 'trial', store = 'trial', expires_at = now() + interval '5 days' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'trial' and got.source = 'trial' and got.max_banks = 2 and got.history_days = 730
    then out := out || 'trial ok; ' else bad := bad + 1; out := out || format('trial BAD %s; ', row_to_json(got)); end if;

  -- 3. An expired trial is free.
  update public.subscriptions set expires_at = now() - interval '1 minute' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'free' and got.source = 'free' and got.max_banks = 0
    then out := out || 'expired->free ok; ' else bad := bad + 1; out := out || format('expired BAD %s; ', row_to_json(got)); end if;

  -- 4. Status expired never counts, even with a future date; grace does.
  update public.subscriptions set plan = 'tusklet', store = 'play', status = 'expired', expires_at = now() + interval '5 days' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'free' then out := out || 'status expired ok; ' else bad := bad + 1; out := out || 'status expired BAD; '; end if;
  update public.subscriptions set status = 'grace' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'tusklet' and got.source = 'own' and got.history_days = 365
    then out := out || 'grace ok; ' else bad := bad + 1; out := out || format('grace BAD %s; ', row_to_json(got)); end if;

  -- 5. A herd mate's Tusk Herd beats my Tusklet, and pools the herd's banks.
  update public.herd_members set herd_id = h where user_id = kel;
  update public.subscriptions set plan = 'tusk_herd', store = 'play', status = 'active', expires_at = now() + interval '20 days' where user_id = kel;
  select * into got from public.plan_for(me);
  if got.plan = 'tusk_herd' and got.source = 'herd' and got.scope = 'herd' and got.max_banks = 15
     and got.banks_used = live_herd then out := out || 'herd plan ok; '
  else bad := bad + 1; out := out || format('herd plan BAD %s; ', row_to_json(got)); end if;

  -- 6. Kel leaves: the cover goes with him.
  update public.herd_members set herd_id = kel_home where user_id = kel;
  select * into got from public.plan_for(me);
  if got.plan = 'tusklet' then out := out || 'leaver ok; ' else bad := bad + 1; out := out || format('leaver BAD %s; ', row_to_json(got)); end if;

  -- 7. Archived banks never count.
  update public.plaid_items set status = 'archived' where user_id = me;
  select * into got from public.plan_for(me);
  if got.banks_used = 0 then out := out || 'archived ok; ' else bad := bad + 1; out := out || format('archived BAD %s; ', got.banks_used); end if;

  -- 8. A new signup starts a 30-day trial.
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (new_user, 'plan-check-' || new_user || '@example.invalid', '{}', 'authenticated', 'authenticated');
  select * into got from public.plan_for(new_user);
  if got.plan = 'trial' and got.expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
    then out := out || 'signup trial ok; ' else bad := bad + 1; out := out || format('signup BAD %s; ', row_to_json(got)); end if;

  raise exception 'PLAN_CHECK % | %', case when bad = 0 then 'all PASS' else bad || ' FAILED' end, out;
end $$;
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx -y supabase@2.118.0 db query --linked -f scripts/plan-check.sql`
Expected: an error that `public.plan_for` does not exist.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261008120000_phase14a_plans.sql`:

```sql
-- Phase 14a: plans, subscriptions and the effective plan.
-- Spec: docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md

-- 1. Plans. Limits live here so tuning them needs no app release.
create table public.plans (
  id text primary key,
  rank int not null unique,
  max_banks int not null check (max_banks >= 0),
  history_days int not null check (history_days between 0 and 730),
  ai boolean not null,
  scope text not null check (scope in ('self', 'herd'))
);

insert into public.plans (id, rank, max_banks, history_days, ai, scope) values
  ('free',      0,  0,   0, false, 'self'),
  ('trial',     1,  2, 730, true,  'self'),
  ('tusklet',   2,  3, 365, true,  'self'),
  ('tusk',      3, 10, 730, true,  'self'),
  ('tusk_herd', 4, 15, 730, true,  'herd');

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (true);
grant select on public.plans to authenticated;

-- 2. Subscriptions: one row per user. Only the service role writes (the
-- signup trigger, and later the store webhook and the daily job).
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null references public.plans (id),
  store text not null check (store in ('play', 'app_store', 'comp', 'trial')),
  status text not null default 'active' check (status in ('active', 'grace', 'expired')),
  expires_at timestamptz,
  over_limit_since timestamptz,
  updated_at timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
-- Your own row, and a herd mate's Tusk Herd (so the app can say who covers you).
create policy subscriptions_read on public.subscriptions for select to authenticated using (
  user_id = (select auth.uid())
  or (plan = 'tusk_herd' and private.is_herd_member((select private.my_herd_id()), user_id))
);
grant select on public.subscriptions to authenticated;

-- 3. The resolver: the best-ranked of my live row, a herd mate's live Tusk
-- Herd, and free. A row is live when active or in grace and not past expiry.
create function private.effective_plan(p_user uuid)
returns table (plan text, source text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.plan, c.source, c.expires_at
  from (
    select s.plan, case when s.store = 'trial' then 'trial' else 'own' end as source, s.expires_at
    from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('active', 'grace')
      and (s.expires_at is null or s.expires_at > now())
    union all
    select s.plan, 'herd', s.expires_at
    from public.subscriptions s
    join public.herd_members mate on mate.user_id = s.user_id
    join public.herd_members me on me.herd_id = mate.herd_id and me.user_id = p_user
    where s.user_id <> p_user
      and s.plan = 'tusk_herd'
      and s.status in ('active', 'grace')
      and (s.expires_at is null or s.expires_at > now())
    union all
    select 'free', 'free', null
  ) c
  join public.plans p on p.id = c.plan
  order by p.rank desc
  limit 1
$$;

revoke execute on function private.effective_plan(uuid) from public;

-- 4. The plan with its limits and the banks counted against it. Service role
-- only: Edge Functions ask about the caller or an Item's connector.
create function public.plan_for(p_user uuid)
returns table (
  plan text, source text, expires_at timestamptz,
  max_banks int, history_days int, ai boolean, scope text, banks_used int
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.plan, e.source, e.expires_at, p.max_banks, p.history_days, p.ai, p.scope,
    (select count(*)::int from public.plaid_items i
     where i.status <> 'archived'
       and case when p.scope = 'herd'
         then i.herd_id = (select m.herd_id from public.herd_members m where m.user_id = p_user)
         else i.user_id = p_user end)
  from private.effective_plan(p_user) e
  join public.plans p on p.id = e.plan
$$;

revoke execute on function public.plan_for(uuid) from public, anon, authenticated;
grant execute on function public.plan_for(uuid) to service_role;

-- 5. The same, for the signed-in user (the app's Plan screen in 14c).
create function public.my_plan()
returns table (
  plan text, source text, expires_at timestamptz,
  max_banks int, history_days int, ai boolean, scope text, banks_used int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.plan_for((select auth.uid()))
$$;

revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- 6. Everyone who exists today is comped Tusk, so nobody loses a bank.
insert into public.subscriptions (user_id, plan, store)
select id, 'tusk', 'comp' from auth.users
on conflict (user_id) do nothing;

-- 7. Every new user starts a 30-day trial. Same body as 9b, plus the last insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_herd uuid;
begin
  v_name := coalesce(
    public.clean_display_name(new.raw_user_meta_data ->> 'display_name'),
    public.clean_display_name(split_part(new.email, '@', 1)),
    'Me'
  );
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  insert into public.herds (name) values (public.default_herd_name(v_name)) returning id into v_herd;
  insert into public.herd_members (herd_id, user_id, role) values (v_herd, new.id, 'owner');
  insert into public.subscriptions (user_id, plan, store, expires_at)
  values (new.id, 'trial', 'trial', now() + interval '30 days');
  return new;
end;
$$;
```

- [ ] **Step 5: Apply it to dev**

Run: `npx -y supabase@2.118.0 db push`
Expected: `Applying migration 20261008120000_phase14a_plans.sql...` then `Finished supabase db push.`

- [ ] **Step 6: Run the check**

Run: `npx -y supabase@2.118.0 db query --linked -f scripts/plan-check.sql`
Expected: the error text contains `PLAN_CHECK all PASS` and eight `ok` cases.

- [ ] **Step 7: Confirm nothing leaked and the grants are right**

Run:
```sh
npx -y supabase@2.118.0 db query --linked -o csv "select (select count(*) from auth.users where email like 'plan-check-%') as leaked_users, (select count(*) from public.subscriptions where store = 'comp') as comps, (select count(*) from auth.users) as users, has_function_privilege('authenticated', 'public.plan_for(uuid)', 'EXECUTE') as auth_plan_for, has_function_privilege('authenticated', 'public.my_plan()', 'EXECUTE') as auth_my_plan, has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE') as auth_update_subs"
```
Expected: `leaked_users` 0, `comps` = `users`, `auth_plan_for` f, `auth_my_plan` t, `auth_update_subs` f.

- [ ] **Step 8: Commit**

```sh
git add supabase/migrations/20261008120000_phase14a_plans.sql scripts/plan-check.sql
git commit -m "feat(db): plans, subscriptions and the effective plan (Phase 14a)"
```

---

### Task 2: RLS check covers plans and subscriptions

**Files:**
- Modify: `scripts/rls-check.mjs` (the `counts` array near line 94; the authenticated block after the Phase 12b checks near line 368; `WRITE_EXPECT` near line 478)

**Interfaces:**
- Consumes: Task 1's tables and `public.my_plan()`.

- [ ] **Step 1: Add the visibility counts**

Append to the `counts` array, before its closing `];`:

```js
  ['plans', `select count(*) from public.plans`, `select count(*) from public.plans`],
  [
    'subscriptions',
    // Your own row, and a herd mate's Tusk Herd.
    `select count(*) from public.subscriptions s where s.user_id = u or (s.plan = 'tusk_herd' and exists (select 1 from public.herd_members m where m.herd_id = h and m.user_id = s.user_id))`,
    `select count(*) from public.subscriptions`,
  ],
```

- [ ] **Step 2: Add the write probes**

In `block()`, directly after the line `w := w || jsonb_build_object('own_ai_switch', ai_on);`, add:

```sql
  -- Phase 14a: plans and subscriptions are server-written; my_plan is mine.
  begin
    update public.subscriptions set plan = 'tusk_herd' where user_id = u;
    w := w || jsonb_build_object('update_own_subscription', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('update_own_subscription', 'denied');
  end;
  begin
    insert into public.subscriptions (user_id, plan, store) values (gen_random_uuid(), 'tusk', 'comp');
    w := w || jsonb_build_object('insert_subscription', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('insert_subscription', 'denied');
  end;
  begin
    update public.plans set max_banks = 99 where id = 'free';
    w := w || jsonb_build_object('update_plans', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('update_plans', 'denied');
  end;
  begin
    perform 1 from public.plan_for(u);
    w := w || jsonb_build_object('call_plan_for', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('call_plan_for', 'denied');
  end;
  w := w || jsonb_build_object('my_plan_rows', (select count(*) from public.my_plan()));
```

- [ ] **Step 3: Add the expectations**

Add to `WRITE_EXPECT`:

```js
  update_own_subscription: 'denied',
  insert_subscription: 'denied',
  update_plans: 'denied',
  call_plan_for: 'denied',
  my_plan_rows: 1,
```

- [ ] **Step 4: Run it, including a two-member herd**

Run: `node scripts/rls-check.mjs` then `node scripts/rls-check.mjs --join 706f7db5-e7e2-4024-bfe3-de3e23954ed2 ccbd42ef-cba6-4f05-a100-a83a727255b2`
Expected: both end with `all PASS`, and the new lines (`plans`, `subscriptions`, the five probes) show PASS.

- [ ] **Step 5: Commit**

```sh
git add scripts/rls-check.mjs
git commit -m "test(rls): plans and subscriptions are read-only to the app (Phase 14a)"
```

---

### Task 3: `_shared/plans.ts`, and AI follows the plan

**Files:**
- Create: `supabase/functions/_shared/plans.ts`
- Create: `supabase/functions/_shared/plans.test.ts`
- Modify: `supabase/functions/_shared/ai.ts:66-73` (remove the `aiAllowed` stub)
- Modify: `supabase/functions/_shared/ai.test.ts:8,61-63` (remove its import and test)
- Modify: `supabase/functions/_shared/sync.ts:12,221-238` (`jevEnabled`)
- Modify: `supabase/functions/_shared/sync.test.ts:16-52,97-130` (fake `rpc`, gate tests)

**Interfaces:**
- Consumes: `public.plan_for(p_user uuid)` from Task 1.
- Produces (in `_shared/plans.ts`):
  - `type PlanId = 'free' | 'trial' | 'tusklet' | 'tusk' | 'tusk_herd'`
  - `type PlanState = { plan: PlanId; source: 'own' | 'herd' | 'trial' | 'free'; expires_at: string | null; max_banks: number; history_days: number; ai: boolean; scope: 'self' | 'herd'; banks_used: number }`
  - `loadPlan(admin: SupabaseClient, userId: string): Promise<PlanState>` — throws on any read error.
  - `canAddBank(p: PlanState): boolean`
  - `overLimit(p: PlanState): boolean`
  - `historyDays(p: PlanState): number` — 1..730
  - `aiAllowed(p: PlanState): boolean`
  - `planLimitBody(p: PlanState): { error: 'plan_limit'; plan: PlanId; max_banks: number }`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/plans.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/plans.test.ts`
Expected: FAIL, module `./plans.ts` not found.

- [ ] **Step 3: Write `_shared/plans.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/plans.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Move the AI gate onto the plan**

In `supabase/functions/_shared/ai.ts`, delete the `aiAllowed` stub and its doc comment (lines 66–73, from `/**\n * Whether this herd may use AI decisions.` through the closing `}`).

In `supabase/functions/_shared/ai.test.ts`, remove `aiAllowed,` from the import list and delete the test `'aiAllowed lets every herd through for now — the seam a subscription check will fill'` (three lines).

In `supabase/functions/_shared/sync.ts`, remove `aiAllowed,` from the `./ai.ts` import, add `import { aiAllowed, loadPlan } from './plans.ts';` beside the other `./` imports, and replace `jevEnabled` with:

```ts
/**
 * Whether Jev may decide anything for this Item (12d). It needs a key, a plan
 * that includes AI (14a: the connector's plan), and the connector's own switch:
 * one switch covers every surface, off by default. Checked once per sync.
 * Never throws: unsure means no.
 */
export async function jevEnabled(
  admin: SupabaseClient,
  item: { user_id: string; herd_id: string },
): Promise<boolean> {
  try {
    if (!hasJevKey()) return false;
    if (!aiAllowed(await loadPlan(admin, item.user_id))) return false;
    const { data, error } = await admin
      .from('profiles').select('ai_categorize').eq('user_id', item.user_id).maybeSingle();
    if (error) return false;
    return data?.ai_categorize === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Teach the fake client `rpc`, and update the gate tests**

In `supabase/functions/_shared/sync.test.ts`, inside `fakeAdmin`, add `'rpc'` to the verb list:

```ts
    for (const verb of ['select', 'update', 'upsert', 'insert', 'delete', 'rpc']) {
```

and change the returned `admin` to:

```ts
    admin: {
      from: (table: string) => make(table),
      rpc: (fn: string, args: unknown) => make(fn).rpc(args),
    } as unknown as SupabaseClient,
```

Add near `ITEM`:

```ts
/** plan_for's answer for a connector on a plan with (or without) AI. */
const PLAN_AI = { data: { plan: 'tusk', source: 'own', expires_at: null, max_banks: 10, history_days: 730, ai: true, scope: 'self', banks_used: 1 } };
const PLAN_FREE = { data: { plan: 'free', source: 'free', expires_at: null, max_banks: 0, history_days: 0, ai: false, scope: 'self', banks_used: 0 } };
```

Replace the four `jevEnabled` tests' fake setups so every keyed test plans a `plan_for:rpc` answer, and add two:

```ts
Deno.test('jevEnabled: a user who has not opted in gets no Jev decisions', async () => {
  await withKey(async () => {
    const { admin, of } = fakeAdmin({ 'plan_for:rpc': [PLAN_AI], 'profiles:select': [{ data: { ai_categorize: false } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    // The connector's own switch.
    assertEquals(of('profiles', 'select')[0].filters, [['eq', 'user_id', 'user-1']]);
  });
});

Deno.test('jevEnabled: key, plan and switch together turn it on', async () => {
  await withKey(async () => {
    const { admin, of } = fakeAdmin({ 'plan_for:rpc': [PLAN_AI], 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), true);
    // The connector's plan, not the herd's or the caller's.
    assertEquals(of('plan_for', 'rpc')[0].payload, { p_user: 'user-1' });
  });
});

Deno.test('jevEnabled: a plan without AI means off, and the switch is never read', async () => {
  await withKey(async () => {
    const { admin, of } = fakeAdmin({ 'plan_for:rpc': [PLAN_FREE], 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    assertEquals(of('profiles', 'select').length, 0);
  });
});

Deno.test('jevEnabled: a failed plan read means off, never a thrown sync', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'plan_for:rpc': [{ data: null, error: { message: 'boom' } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
  });
});

Deno.test('jevEnabled: a failed profile read means off, never a thrown sync', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'plan_for:rpc': [PLAN_AI], 'profiles:select': [{ data: null, error: { message: 'boom' } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
  });
});
```

Keep `'jevEnabled: without a key nothing is read'` as it is: with no key, `calls.length` stays 0.

- [ ] **Step 7: Run every Edge Function test**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: all pass, no failures. `grep -rn "aiAllowed" supabase/functions` shows only `plans.ts`, `plans.test.ts` and `sync.ts`.

- [ ] **Step 8: Commit**

```sh
git add supabase/functions/_shared/plans.ts supabase/functions/_shared/plans.test.ts supabase/functions/_shared/ai.ts supabase/functions/_shared/ai.test.ts supabase/functions/_shared/sync.ts supabase/functions/_shared/sync.test.ts
git commit -m "feat(sync): AI decisions follow the connector's plan (Phase 14a)"
```

---

### Task 4: Bank limits and history depth in link-token and exchange-token

**Files:**
- Modify: `supabase/functions/plaid-create-link-token/index.ts`
- Modify: `supabase/functions/plaid-exchange-token/index.ts`

**Interfaces:**
- Consumes: `loadPlan`, `canAddBank`, `overLimit`, `historyDays`, `planLimitBody` from `_shared/plans.ts`.
- Produces: `402 { error: 'plan_limit', plan, max_banks }` from both functions (Task 5 reads it).

- [ ] **Step 1: link-token refuses at the limit and asks for the plan's history**

In `plaid-create-link-token/index.ts`, add the import:

```ts
import { canAddBank, historyDays, loadPlan, planLimitBody, type PlanState } from '../_shared/plans.ts';
```

After the `if (body.item_id) { … }` block and before `try {`, add:

```ts
  // A new bank must fit the plan (Phase 14). Reconnecting an existing bank
  // (update mode) is never a new bank, so it is never refused.
  let plan: PlanState | null = null;
  if (!accessToken) {
    try {
      plan = await loadPlan(admin, user.id);
    } catch (err) {
      // Unsure means no: never open Link on a plan we could not read.
      console.error('plan read failed', err);
      return jsonResponse({ error: 'Could not check your plan' }, 500);
    }
    if (!canAddBank(plan)) return jsonResponse(planLimitBody(plan), 402);
  }
```

In the `linkTokenCreate` call, replace the products spread with:

```ts
      ...(accessToken
        ? { access_token: accessToken }
        : {
          products: [Products.Transactions],
          // How far back the first pull reaches. Plaid's default is 90 days.
          transactions: { days_requested: historyDays(plan!) },
        }),
```

- [ ] **Step 2: exchange-token checks before the exchange, and again after**

In `plaid-exchange-token/index.ts`, add the import:

```ts
import { canAddBank, loadPlan, overLimit, planLimitBody } from '../_shared/plans.ts';
```

Inside the `try`, directly after `const { herd_id: herdId } = await getCallerHerd(admin, user.id);`, add:

```ts
    // The plan check that counts (Phase 14): the Item, and Plaid's bill, is
    // created below. Before the exchange, so a refused bank never gets a token.
    // A failed read throws into the catch below: 500, never an unchecked bank.
    const plan = await loadPlan(admin, user.id);
    if (!canAddBank(plan)) return jsonResponse(planLimitBody(plan), 402);
```

After step 3 (the `plaid_tokens` upsert) and before step 4 (`syncAccounts`), add:

```ts
    // 3b. Two links at once can both pass the check above. Count again now the
    //     Item exists; if this one tipped the plan over, remove it at Plaid (the
    //     only thing that stops the bill) and forget it.
    const after = await loadPlan(admin, user.id);
    if (overLimit(after)) {
      await plaid.itemRemove({ access_token: exchange.access_token });
      await admin.from('plaid_items').delete().eq('id', item.id);
      console.log(`over plan limit after link, removed: user ${user.id}, item ${item.id}`);
      return jsonResponse(planLimitBody(after), 402);
    }
```

- [ ] **Step 3: Type-check both functions**

Run: `npx -y deno check supabase/functions/plaid-create-link-token/index.ts supabase/functions/plaid-exchange-token/index.ts`
Expected: no errors.

- [ ] **Step 4: Deploy the changed functions to dev**

Run: `npx -y supabase@2.118.0 functions deploy plaid-create-link-token plaid-exchange-token plaid-sync-transactions plaid-webhook --use-api`
Expected: each reports `Deployed Functions … plaid-…`. (sync and webhook carry the new `jevEnabled`.)

- [ ] **Step 5: Live-check the refusal as Kel Test**

Kel Test has no banks and, after Task 1, a comp Tusk row. Use the scratchpad `as-user.mjs` (signs in as Kel with the anon key from `apps/mobile/.env` and the dev-only password in `tusky-tooling-notes` memory; recreate it if the scratchpad is gone). Set Kel to Free, then call:

```sh
npx -y supabase@2.118.0 db query --linked "update public.subscriptions set plan = 'trial', store = 'trial', expires_at = now() - interval '1 day' where user_id = '706f7db5-e7e2-4024-bfe3-de3e23954ed2'"
node <scratchpad>/as-user.mjs plaid-create-link-token '{}'
node <scratchpad>/as-user.mjs plaid-exchange-token '{"public_token":"public-sandbox-not-real"}'
```

Expected: both answer `402 {"error":"plan_limit","plan":"free","max_banks":0}`. The exchange refuses before Plaid is ever called (a real call with that fake token would be a 500).

- [ ] **Step 6: Live-check that a plan with room opens Link, and update mode is never refused**

```sh
npx -y supabase@2.118.0 db query --linked "update public.subscriptions set expires_at = now() + interval '30 days' where user_id = '706f7db5-e7e2-4024-bfe3-de3e23954ed2'"
node <scratchpad>/as-user.mjs plaid-create-link-token '{}'
node <scratchpad>/as-user.mjs plaid-create-link-token '{"item_id":"00000000-0000-0000-0000-000000000000"}'
```

Expected: the first returns `200` with a `link_token` (trial, 0 of 2). The second returns `404 Unknown bank connection`: update mode goes straight to the ownership check and never to the plan check. Then restore Kel:

```sh
npx -y supabase@2.118.0 db query --linked "update public.subscriptions set plan = 'tusk', store = 'comp', expires_at = null where user_id = '706f7db5-e7e2-4024-bfe3-de3e23954ed2'"
```

- [ ] **Step 7: Commit**

```sh
git add supabase/functions/plaid-create-link-token/index.ts supabase/functions/plaid-exchange-token/index.ts
git commit -m "feat(plaid): bank limits and history depth follow the plan (Phase 14a)"
```

---

### Task 5: The app explains a plan limit

**Files:**
- Modify: `apps/mobile/src/lib/functions.ts` (return the parsed body too)
- Create: `apps/mobile/src/lib/plans.ts`
- Create: `apps/mobile/src/lib/plans.test.ts`
- Modify: `apps/mobile/src/lib/plaid.ts:33-66`

**Interfaces:**
- Consumes: the 402 body from Task 4.
- Produces: `readFunctionError(err): Promise<{ status?: number; message?: string; body?: Record<string, unknown> }>`; `planLimitMessage(plan: unknown, maxBanks: unknown): string` in `lib/plans.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/plans.test.ts`:

```ts
/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planLimitMessage } from './plans.ts';

test('a finished trial says so', () => {
  assert.equal(
    planLimitMessage('free', 0),
    'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here. Plans are coming soon.',
  );
});

test('a paid plan names its limit, singular and plural', () => {
  assert.equal(
    planLimitMessage('tusklet', 3),
    'Your plan connects up to 3 banks, and you have reached it. Disconnect one in Settings to add another.',
  );
  assert.equal(
    planLimitMessage('trial', 1),
    'Your plan connects up to 1 bank, and you have reached it. Disconnect one in Settings to add another.',
  );
});

test('an unreadable body still gives a sentence', () => {
  assert.equal(
    planLimitMessage(undefined, undefined),
    'Your plan has reached its bank limit. Disconnect one in Settings to add another.',
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `apps/mobile`): `npm test`
Expected: FAIL, cannot find `./plans.ts`.

- [ ] **Step 3: Write `lib/plans.ts`**

```ts
/**
 * What the app says when the server refuses a bank for the plan (Phase 14a).
 * The server decides; this only words the 402 body `{ plan, max_banks }`.
 */
export function planLimitMessage(plan: unknown, maxBanks: unknown): string {
  if (plan === 'free') {
    return 'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here. Plans are coming soon.';
  }
  if (typeof maxBanks === 'number' && maxBanks > 0) {
    const banks = maxBanks === 1 ? '1 bank' : `${maxBanks} banks`;
    return `Your plan connects up to ${banks}, and you have reached it. Disconnect one in Settings to add another.`;
  }
  return 'Your plan has reached its bank limit. Disconnect one in Settings to add another.';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run (in `apps/mobile`): `npm test`
Expected: all tests pass, including the three new ones.

- [ ] **Step 5: Return the body from `readFunctionError`**

Replace `apps/mobile/src/lib/functions.ts`'s function with:

```ts
export async function readFunctionError(
  err: unknown,
): Promise<{ status?: number; message?: string; body?: Record<string, unknown> }> {
  const response = (err as { context?: Response }).context;
  let message: string | undefined;
  let body: Record<string, unknown> | undefined;
  try {
    const parsed = await response?.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // non-JSON body; the caller keeps its own wording
  }
  return { status: response?.status, message, body };
}
```

Keep the file's existing doc comment above it.

- [ ] **Step 6: Show the message in the connect flow**

In `apps/mobile/src/lib/plaid.ts`, add `import { planLimitMessage } from './plans';` beside the `./functions` import. Replace the link-token check:

```ts
      if (fnError || !data?.link_token) {
        throw new Error('Could not start the bank connection. Try again in a moment.');
      }
```

with:

```ts
      if (fnError) {
        const { status, message, body } = await readFunctionError(fnError);
        if (status === 402 && message === 'plan_limit') {
          throw new Error(planLimitMessage(body?.plan, body?.max_banks));
        }
      }
      if (fnError || !data?.link_token) {
        throw new Error('Could not start the bank connection. Try again in a moment.');
      }
```

In the exchange error handling, after the `409 duplicate` branch and before the generic `throw`, add:

```ts
                if (status === 402 && message === 'plan_limit') {
                  throw new Error(planLimitMessage(body?.plan, body?.max_banks));
                }
```

and change that `readFunctionError` destructuring to `const { status, message, body } = await readFunctionError(exchangeError);`.

- [ ] **Step 7: Type-check and lint**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint`
Expected: no errors.

- [ ] **Step 8: One emulator pass**

With Metro running and the test user signed in: set the test user to an expired trial, tap **Connect a bank** in Settings, and read the error with `node scripts/emu.mjs ui`. Then restore the comp row.

```sh
npx -y supabase@2.118.0 db query --linked "update public.subscriptions set plan = 'trial', store = 'trial', expires_at = now() - interval '1 day' where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"
node scripts/emu.mjs tap "Connect a bank"
node scripts/emu.mjs ui | grep -i "trial has ended"
npx -y supabase@2.118.0 db query --linked "update public.subscriptions set plan = 'tusk', store = 'comp', expires_at = null where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"
```

Expected: the `grep` prints the "Your free trial has ended…" line. The label to tap may differ; take it from `emu ui`.

- [ ] **Step 9: Commit**

```sh
git add apps/mobile/src/lib/functions.ts apps/mobile/src/lib/plans.ts apps/mobile/src/lib/plans.test.ts apps/mobile/src/lib/plaid.ts
git commit -m "feat(app): say why a bank was refused for the plan (Phase 14a)"
```

---

### Task 6: Docs, handoff and PR

**Files:**
- Modify: `CLAUDE.md` (the Phase 12b paragraph's `aiAllowed()` sentence; a new Phase 14a bullet under Conventions)
- Modify: `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md` (Testing: plan resolution is proved in SQL)
- Create: `docs/superpowers/plans/2026-09-28-phase-14a-handoff.md`

- [ ] **Step 1: CLAUDE.md**

In the "The AI fallback (Phase 12b…)" bullet, replace the sentence beginning ``aiAllowed()` is the single server-side seam`` with: ``Since 14a, `aiAllowed(plan)` (`_shared/plans.ts`) gates it on the connector's plan.``

Add a Conventions bullet after "Preset budgets (Phase 13)":

```markdown
- **Plans** (Phase 14a). `plans` holds the limits (banks, history days, AI, self or herd scope);
  `subscriptions` has one row per user, written only by the service role (the signup trigger's
  30-day trial today, the store webhook and daily job later). `private.effective_plan` picks the
  best of my live row, a herd mate's live `tusk_herd`, and `free`; `plan_for(user)` (service role
  only) adds the limits and `banks_used`, and `my_plan()` is the app's view of it. A bank counts
  against its connector's plan, or the herd's pool under `tusk_herd`; archived banks never count.
  `plaid-create-link-token` and `plaid-exchange-token` refuse a new bank with
  `402 { error: 'plan_limit', plan, max_banks }` (update mode is never refused), and link-token sets
  `days_requested` from the plan. Exchange-token checks again after recording the Item and removes
  it at Plaid if a race tipped the plan over. `scripts/plan-check.sql` proves the resolver on dev.
  Spec: `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md`.
```

- [ ] **Step 2: Spec note**

In the spec's Testing section, replace "the plan resolution and the bank-count rules (pure, mirrored in TypeScript for tests)" with "the bank-count and limit helpers (`_shared/plans.ts`); the plan resolution itself is proved in SQL by `scripts/plan-check.sql`, so it is never mirrored".

- [ ] **Step 3: Write the handoff**

Create `docs/superpowers/plans/2026-09-28-phase-14a-handoff.md` with: what shipped (Tasks 1–5), the dev state (migration applied, four functions deployed, every existing user comped Tusk), the verification actually run with its results (plan-check, rls-check both runs, deno tests, npm test, the Kel live checks, the emulator pass), and what waits on Pedro: the production push (`db push --project-ref awiwcgrisyzimzxgddxu` plus the four functions). Production's comp rows come from the same migration, so real users keep their banks.

- [ ] **Step 4: Run the full gate once more**

```sh
npx -y deno test --allow-env supabase/functions/_shared/
npx -y supabase@2.118.0 db query --linked -f scripts/plan-check.sql
node scripts/rls-check.mjs
cd apps/mobile && npm test && npm run typecheck && npx expo lint
```

Expected: all pass; plan-check reports `all PASS`; rls-check ends `all PASS`.

- [ ] **Step 5: Commit, push, open the PR**

```sh
git add CLAUDE.md docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md docs/superpowers/plans/2026-09-28-phase-14a-handoff.md
git commit -m "docs: Phase 14a handoff, and plans in CLAUDE.md"
git push -u origin pedro-14-spec
git branch --unset-upstream
```

Then, in PowerShell (refresh PATH first, per `tusky-tooling-notes`):
`gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro-14-spec --title "Phase 14a: plans and limits (+ monetization spec)"`, with a body listing the spec, the plan, what 14a enforces, and the test results. Pedro merges.
