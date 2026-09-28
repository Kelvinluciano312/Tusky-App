# Phase 14a handoff: plans and limits

Plan: `docs/superpowers/plans/2026-09-28-phase-14a-plans-and-limits.md`.
Spec: `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md`.

With 14a, every user has a plan, and the server enforces its bank limit, history depth and AI
access. There is no store yet: plans are set by writing `subscriptions` rows.

## What shipped

- **Database** (`20261008120000_phase14a_plans.sql`):
  - `plans` holds the five plans and their limits.
  - `subscriptions` has one row per user and is readable only by that user, plus herd mates when
    the row is a Tusk Herd. The app can't write either table.
  - `private.effective_plan` picks the plan. `plan_for(user)` (service role only) and `my_plan()`
    (the signed-in user) wrap it with the limits and `banks_used`.
  - `handle_new_user` also starts a 30-day trial. Everyone who existed when the migration ran is
    comped Tusk.
- **Edge Functions:**
  - `_shared/plans.ts` holds `loadPlan` and the pure helpers.
  - `plaid-create-link-token` refuses a new bank at the limit (402 `plan_limit`) and sets
    `transactions.days_requested` from the plan. Before this, every bank got Plaid's default of
    90 days.
  - `plaid-exchange-token` checks before the exchange, and again after recording the Item. If a
    race tipped the plan over, only the bank past the limit in link order is removed at
    Plaid, so two racing links never cost the user both banks (fixed after the final review).
  - `jevEnabled` now asks the connector's plan; the `aiAllowed` placeholder is gone from `ai.ts`.
- **App:** a refused bank shows why ("Your free trial has ended…", or "Your plan connects up to N
  banks…"). The paywall and Plan screen are 14c.

## State of dev

- The migration is applied. `plaid-create-link-token`, `plaid-exchange-token`,
  `plaid-sync-transactions` and `plaid-webhook` are deployed.
- All 4 dev users are comped Tusk. The test user and Kel Test were set back to comp after testing.

## What was verified

- `scripts/plan-check.sql` (new, rolls back): all 9 cases PASS. They cover comp, active trial,
  expired trial, `expired` status, grace, a herd mate's Tusk Herd with a pooled bank count, that mate
  leaving, archived banks not counting, and a new signup's trial.
- `scripts/rls-check.mjs`: all PASS, alone and with `--join` (Kel joined). New lines: `plans`,
  `subscriptions`, and the probes `update_own_subscription`, `insert_subscription`, `update_plans`
  and `call_plan_for` (all denied), plus `my_plan_rows` = 1.
- Deno: 230 tests pass (8 new in `plans.test.ts`; `jevEnabled` has plan-off and plan-read-failure
  cases). App: `npm test` 104 pass, typecheck and lint clean.
- Live, as Kel Test on dev:
  - Free: link-token and exchange-token both answer 402 `plan_limit`. The exchange refuses before
    Plaid is called.
  - Trial with room: link-token answers 200, which also shows Plaid accepts `days_requested`.
  - Update mode never reaches the plan check.
- Emulator: with the test user on an expired trial, **Connect another bank** shows the trial-ended
  message.

## Things to know

- **No test covers a herd mate's Tusk Herd row being visible under RLS.** No dev row is `tusk_herd`,
  so rls-check never meets one; the resolver side is covered by plan-check. 14c's Plan screen is the
  first reader.
- **The race path in exchange-token** (removing an Item at Plaid after a recount) is code-reviewed,
  not exercised live: it needs two links finishing at the same moment.
- **Syncs do not check limits.** A user already over their limit (after a downgrade) keeps syncing
  until 14b's daily job acts.

## Waits on Pedro

- **Production:** `npx -y supabase@2.118.0 db push --project-ref awiwcgrisyzimzxgddxu`, then deploy
  the four functions there.
  - The same migration comps every production user, so real users keep their banks.
  - Production is also still missing Phase 12d's migration (`20261007120000`). `db push` applies
    both, in order.
- **Next: 14b**, what happens when a plan ends (the daily job, the 7-day window, the banners) and
  merging history on reconnect.
