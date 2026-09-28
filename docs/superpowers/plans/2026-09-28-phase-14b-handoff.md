# Phase 14b handoff — plan lifecycle and reconnect merge

Plan: `2026-09-28-phase-14b-lifecycle-and-merge.md`. Spec: `../specs/2026-09-28-phase-14-monetization-design.md`.
Branch `pedro-14b`. Dev only; production is untouched.

## What shipped

1. **The decision** (`_shared/enforce.ts`: `decide`, `sameSecret`, `CHOOSE_DAYS = 7`). Free archives every
   live bank at once. A smaller plan opens a 7-day window, then archives the newest banks past the limit
   (`pastLimit`, link order). A herd pool is judged once. With no configured secret, nothing is accepted.
2. **`plan-enforcer`** (public, `verify_jwt = false`, `x-cron-secret` checked first). `runEnforcer` judges
   each user with a live bank or an open window, once per herd under `tusk_herd`, and archives through
   `disconnectItem(…, 'archive')`. `{ "dry_run": true }` reports without acting. Migration
   `20261009120000` schedules it daily at 09:00 UTC through pg_cron and pg_net, reading `project_url` and
   `cron_secret` from Vault.
3. **The app warns** (`lib/plan-banner.ts`, `components/plan-banner.tsx`, `usePlan` with key `['plan']`).
   The banner shows on Home under the greeting and in Settings above Connections: 3 days before a trial
   ends, and through the window. Bank changes refresh `['plan']`.
4. **The merge plan** (`_shared/merge.ts`: `pairAccounts`, `planMerge`). Pure and unit-tested, including
   history arriving in stages, a payer who left, and identical purchases.
5. **The merge runs in every sync** (`mergeReconnected`, called in `syncItem` after the cursor advance,
   inside try/catch). It pairs accounts only with the same connector, herd, institution, name and mask.

## Dev state

- Migration `20261009120000` is applied. `cron.job` has `plan-enforcer, 0 9 * * *, active`.
- Deployed to dev: `plan-enforcer`, `plaid-sync-transactions`, `plaid-webhook`.
- Vault on dev has `cron_secret` and `project_url`. The function secret `CRON_SECRET` is set. No value was
  printed.
- The test user is restored: Tusk (comp), no window, `plans` back to 0/2/3/10/15.
- The test user now has two archived First Platypus Items: the original one (2026-09-23, now 20 rows, the
  history before the overlap) and the one relinked on 2026-09-28 (392 rows), which the enforcer test
  archived again. Chase is still active.

## Verified

- Unit tests: `deno test _shared/` 247 passed; app `npm test` 110 passed; typecheck and lint are clean.
- Without the header `plan-enforcer` answers 401. A dry run returned 200 with three users, all `tusk`, and
  none of them had anything to archive.
- The cron path end to end: pg_net's response was `202 {"accepted":true}`.
- **The merge, live.** The relink created a new Item. The kept Platypus history went from 349 rows to 20,
  and `kept_in_overlap` is 0 on all 7 paired accounts. Sandbox did give the marked row a twin (same date,
  amount and merchant), and the memo plus the manual category (`coffee_shops`, source `manual`) carried.
- **The enforcer, live.** With Tusklet shrunk to 1 bank, the first run opened the window and archived
  nothing. After a reload, Home showed "Your plan connects up to 1 bank / You have 2. Disconnect 1 in
  Settings within 7 days…". With the window backdated 8 days, the second run archived the new Platypus
  and kept Chase. A third run changed nothing and closed the window.
- `node scripts/rls-check.mjs`: all PASS.

## Known limits (deferred)

- `mergeReconnected` reads every row of a paired new account on every sync, even once the overlap is gone.
  This matters only for users who reconnected a kept bank. It could first read the new account's earliest
  date, and skip when nothing kept is dated on or after it.
- Home's pull-to-refresh does not refetch `['plan']`. The banner updates when the app returns to the
  foreground (focusManager), after a bank change, or after a reload.

## Waits on Pedro (production)

1. Create production's `cron_secret`, `project_url` and `CRON_SECRET` (`docs/ops/production.md`, "Cron").
2. `db push --linked --project-ref awiwcgrisyzimzxgddxu`, which applies 12d, 14a and 14b.
3. Deploy `plan-enforcer`, `plaid-sync-transactions`, `plaid-webhook`, `plaid-create-link-token` and
   `plaid-exchange-token` to production.
