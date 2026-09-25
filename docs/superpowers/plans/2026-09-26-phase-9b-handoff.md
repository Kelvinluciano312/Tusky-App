# Handoff: Phase 9b done, the herd foundation (2026-09-26)

Branch `pedro-9b`, off `master` (with #11 merged). Spec: `docs/superpowers/specs/2026-09-25-phase-9-herds-design.md` (section 9b).

## What shipped

**DB (both migrations pushed to dev).**
- `20260926130000_phase9b_herds.sql` adds:
  - `herds` and `herd_members` (one herd per user), with backfilled personal herds;
  - `private.my_herd_id()` and `private.my_account_ids()`;
  - `herd_id` on every owned table;
  - composite cascading keys (item/account + herd);
  - `accounts.is_private` (no UI or grant yet: 9c);
  - the `fill_herd_id` and `category_in_herd` triggers;
  - every policy, view and index rebuilt on herds.
  - `user_id` was dropped from budgets, category_overrides, merchant_rules and categories. The built-in marker is now `herd_id is null`.
- `20260926130100_phase9b_one_fk_per_parent.sql` drops the single-column keys that the composite ones replace. Two relationships to the same parent made PostgREST refuse the app's embeds (PGRST201), and Home showed no accounts until this landed.

**Functions (all deployed to dev).**
- `getAdminClient` reads `SUPABASE_SECRET_KEYS` first, then falls back to the legacy key (Track P).
- New `getCallerHerd`.
- The sync function syncs every live bank in the herd. The webhook passes the item's herd.
- The exchange duplicate check covers the whole herd.
- set-merchant-rule and delete-category are herd-scoped.
- Sync loads rules and transfer categories per herd, and snapshots every herd account.
- Reconnect, disconnect and the sandbox tools stay limited to the member who connected the bank (unchanged `user_id` checks).

**App.** The two upserts use `herd_id,category_id`. Nothing else changed.

**New tool.** `node scripts/rls-check.mjs` (see CLAUDE.md).

**Tests.** Deno 92 (was 91). App 28.

## Verified on dev

**Data moved intact.** Before the migration, each user's counts and a checksum of their transaction categories were recorded, for items, accounts, transactions, snapshots, streams, budgets, categories, overrides and rules. Afterwards, each herd's numbers were identical, and no herd held another user's rows.

**`rls-check`: all PASS for all 3 users.** 15 visibility checks each, across the tables and views. Each user sees only their own herd: for example 48 of the 498 transactions, not all of them. All 4 forbidden writes are refused:
- updating another herd's transaction changes 0 rows;
- updating `amount` is denied;
- planting a budget in another herd is denied;
- reading `plaid_tokens` is denied.

**Emulator regression pass:**
- Home shows −$77,164.15 across 14 accounts, plus Upcoming.
- The feed loads.
- Pull-to-refresh: the sync function returned 200 twice, with no errors in the logs.
- A budget edited from $700 to $750 updated in place (still 4 budgets), then went back to $700.
- Hiding and unhiding Groceries went through the herd-keyed override.
- "Always Travel" on Uber created a herd rule and moved 8 of 8 rows. Deleting it restored `rideshare_and_taxi`.
- Reports loads.
- Afterwards, every user's category checksum matched the baseline exactly.

## Things to know

- The failed first push (the `uuid = uuid[]` error) rolled back cleanly. The fix, the `::uuid[]` cast, is in the migration.
- **Not yet exercised:**
  - private accounts across two members, and a real join or leave (9c);
  - `category_in_herd` rejecting a foreign custom category (no user has custom categories on dev right now).
- **Prod (Track P)** gets both 9b migrations with the rest, after Pedro's go-ahead.
