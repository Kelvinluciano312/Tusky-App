# Handoff — Phase 7a done: category groups (2026-09-24)

Branch: `pedro`. Supersedes `2026-09-24-phase-6-handoff.md`. Phase 6's key-switch steps there are still
pending (they wait on Pedro's go-ahead), so read that file before touching Plaid secrets or Items.

- Spec: `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md` (milestone 7a).
- Plan: `docs/superpowers/plans/2026-09-24-phase-7a-taxonomy.md`.

## What shipped

| Area | State |
| --- | --- |
| DB | Migration `20260924190000_phase7a_category_groups.sql`, **pushed**. <ul><li>`categories` gains `parent_id` and `user_id` (null = built-in). `slug` is required only for built-ins.</li><li>Trigger `categories_enforce_tree`: a parent must be a built-in group, and the child copies the group's `kind`.</li><li>RLS select is now "built-ins and your own".</li><li>61 children seeded; `plaid_detailed_map` has 102 rows, service role only; `LOAN_DISBURSEMENTS` added to the primary map.</li><li>New `transactions.merchant_key` (generated, indexed on `(user_id, merchant_key)`) and `merchant_entity_id`.</li><li>Every non-manual row was backfilled.</li></ul> |
| Functions | `resolveCategoryId(sources, maps, fallback)` resolves rule > detailed > primary > fallback. `ignoredCategoryIds` covers every transfer except `credit_card_payment`. `loadSyncContext` loads the detailed map, and sync writes `merchant_entity_id`. Deployed: `plaid-sync-transactions`, `plaid-webhook`. |
| Client | <ul><li>`lib/categories.ts`: `buildTree`, `groupIdOf`, `rollupByGroup`, `budgetsReplacedBy`, `sectionsByKind`.</li><li>Two-level `CategoryPicker`.</li><li>Reports: one donut slice per group, and tapping a group opens its breakdown, including "(general)" for rows on the group itself.</li><li>Budgets on a group or a category, never both, with "Replace …?" prompts. A budgeted group lists its categories as small tappable lines. A "Show all categories" toggle.</li></ul> |
| Tests | Deno: 73 (was 70). New app runner: `cd apps/mobile && npm test` (`node --test`, zero dependencies) runs 13 tests in `src/lib/*.test.ts`. |

## Verified live (Pixel_7 emulator, test user)

- **Backfill.** The 3 manual rows are untouched (checksum `997c59d0…` before and after). Uncategorized fell
  from 133 rows to 0: all 133 were `LOAN_DISBURSEMENTS`, now Loan Disbursements. The 6 card payments are
  now Credit Card Payment.
- **Tree.** 16 groups, 61 children, 0 kind mismatches, 102 detailed-map rows. The trigger refuses a
  grandchild, and a child's kind is forced to its group's. `plaid_detailed_map` ACL: `postgres` and
  `service_role` only.
- **Merchant key.** The SQL and JS keys match on all 450 rows (0 mismatches).
- **Sync.** After deploy, a pull-to-refresh synced Chase cleanly. `merchant_entity_id` is still 0 rows:
  Sandbox re-sent nothing, and old rows fill in only as Plaid re-sends them.
- **Feed.** Rows show the finer categories: Fast Food, Loan Disbursements, Interest Charges, Rideshare &
  Taxi, Online Marketplaces.
- **Picker.** Recategorizing Chipotle to Coffee Shops worked, then was reverted by SQL.
- **Reports.** The donut shows groups only. The drill-in works: Loan Payments → "Loan Payments (general)"
  $2,228.03 + Buy Now Pay Later $20.52. September net −$5,564.40 matches SQL (income 2,835.92, expense
  8,400.32). Before the migration, September expenses were about −$54.5k: $62,972 of loan disbursements
  were inflows sitting in Uncategorized, an expense kind. Card payments ($25 in September) now leave cash flow.
- **Recurring.** "CREDIT CARD 3333 PAYMENT" stays in Bills & subscriptions, on `credit_card_payment`.
  It is the only transfer-kind stream.
- **Budgets.**
  - Coffee Shops $50 saved with no prompt.
  - Food & Dining $300 prompted "Replace 1 category budget…"; Replace left only the group's budget.
  - Groceries prompted "Replace Food & Dining's budget…". Cancel changed nothing; Replace left only
    Groceries.
  - Removed it; the original 4 group budgets are back.

## Things to know

- **A running app keeps the old taxonomy for up to an hour.** `useCategories` has a 1h `staleTime`, so
  after a migration adds categories, an open app shows child ids as "Uncategorized" until a reload.
  Nothing crashes: rollups keep unknown ids under themselves. Deferred minor. The fix would be adding
  `['categories']` to the pull-to-refresh invalidation.
- **Sandbox data is odd.** Restaurants & Bars holds +$1,654.43 of inflows in September, so Food &
  Dining's rollup is −$768.77. The math is right.
- **Deferred minors:** Budgets `save()` deletes the replaced budgets before it upserts, so a failed upsert
  loses them. Also the stale-cache note above.

## What 7b needs (custom categories and built-in overrides)

- **`Category.slug` must become `string | null`.** Custom rows have none. It stays `string` in 7a because
  only built-ins exist.
- **`loadSyncContext` selects every `categories` row.** With custom categories for all users, that grows
  without bound and meets PostgREST's 1000-row cap. Load built-ins plus the Item owner's rows instead.
  Custom transfer children must still reach `ignoredCategoryIds`.
- **Keep `parent_id` out of the client's update grant.** `categories_enforce_tree` does not stop a
  childless group from being made its own parent. The only guard is that no client can write
  `parent_id` on update.
- **Hidden categories.** `sectionsByKind` is where the picker drops them; take a `selectedId`, so a
  hidden category that is currently selected still shows. The spec calls this `pickerSections`.
- **Reuse `user_id default auth.uid()`** on `categories` for client inserts. The
  `categories_slug_iff_builtin` check then requires `slug` to be null for custom rows.
