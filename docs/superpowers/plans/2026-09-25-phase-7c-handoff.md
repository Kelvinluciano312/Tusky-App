# Handoff — Phase 7c done: merchant rules and renaming (2026-09-25)

Branch: `pedro-7c`, off `master` (#6 and #7 merged). Phase 7 is complete. Phase 6's key-switch steps (in `2026-09-24-phase-6-handoff.md`) still wait on Pedro's go-ahead.

- Spec: `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md` (Milestone 7c).
- Plan: `docs/superpowers/plans/2026-09-25-phase-7c-merchant-rules.md`. It is lean on purpose; the code lives only in the commits.

## What shipped

- **DB.** Migration `20260925120000_phase7c_merchant_rules.sql`, pushed. `merchant_rules` has select-only RLS, is `select` to authenticated, and its `category_id` has no cascade.
- **Functions.**
  - New `set-merchant-rule` (JWT-verified). The pure logic is `_shared/rules.ts`: `validateRuleInput`, `mergeRule` and `planReresolve`.
  - `loadCategoryMaps` was extracted from `loadSyncContext`, and both paths share it.
  - `syncItem` applies the owner's rules. `delete-category` moves rules to the group.
  - Deployed: `set-merchant-rule`, `delete-category`, `plaid-sync-transactions`, `plaid-webhook`.
- **Client.**
  - `lib/merchants.ts` (`transactionName`, `streamName`, `validateDisplayName`).
  - `merchant_key` was added to the transaction and stream columns.
  - Hooks: `useMerchantRules`, `useSetMerchantRule`, `useTransaction`.
  - `TransactionRow` and `RecurringRow` show renames, which covers the feed, Recurring and Upcoming.
  - New `/transaction/[id]`: the feed's tap opens it. It has Rename (`RenameSheet`), and the category picker then asks "Just this one / Always".
  - New `/rules` (Settings → "Merchant rules and renames").
- **Tests.** Deno 87 (was 80). App 23 (was 19).

## Verified live

- **`set-merchant-rule` errors.** An empty key, a non-normalized key, a blank name, or an empty change → 400. Another user's or an unknown category → 404. No auth → 401.
- **API round trip on Uber** (8 rows, one set to manual for the test).
  - The rule moved the 7 non-manual rows to Travel; the manual row stayed on Shopping.
  - A sync kept them.
  - Removing the rule restored `rideshare_and_taxi` on all 7 and deleted the rule.
- **Deleting a custom category that a rule used** moved the rule, and its rows, to the Transportation group.
- **Emulator.**
  - The transaction screen (reached by deep link) shows merchant, category, account and description.
  - Rename "Uber" → "Uber Taxi": the rule row, then the feed and Home's Upcoming show it.
  - Category → Travel → **Always**: all 8 rows became Travel, and the screen said "Uber Taxi is always Travel."
  - The Rules screen listed it. **Delete both** restored Plaid's category on all 8, and 0 rules remain.
- **Cleanup.** 0 rules and 0 custom categories. The manual rows are unchanged by these tests. Their baseline is now 5 / `597f579c…`: two rows were set by hand on 09-25, before this session.

## Things to know

- **Deep links need three slashes.** `tusky:///transaction/<id>`. With two slashes, "transaction" parses as the host, and the router shows "Unmatched Route". `adb shell am start -a android.intent.action.VIEW -d "tusky:///transaction/<id>" com.tusky.app` skips scrolling the feed in tests.
- **Sync's own rule path was not exercised on live data,** because Sandbox re-sent no Uber rows. It calls the same, unit-tested resolver.
- **Deferred minor.** On Android, a rule with both parts shows its three actions with no Cancel button (Android allows three buttons at most). Tapping outside cancels.
