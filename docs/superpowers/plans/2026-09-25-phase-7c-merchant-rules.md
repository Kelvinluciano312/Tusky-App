# Phase 7c — Merchant Rules and Renaming Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans). This plan is deliberately lean, with interfaces, tests and decisions but not full code, to save tokens (Pedro, 2026-09-25). The spec is the authority.

**Goal:** "Always categorize this merchant as X" applies to past and future transactions (never manual ones), and renaming a merchant shows everywhere.

**Spec:** `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md`, Milestone 7c, plus "What 7c needs" in `docs/superpowers/plans/2026-09-25-phase-7b-handoff.md`.

**Branch:** `pedro-7c`, off `master`, which has #6 and #7 merged. PR against `master`; never merge.

## Global Constraints

- **Rules never touch `category_is_manual` rows.** Neither the retroactive pass nor sync does.
- **One resolver.** Sync and the retroactive pass both call `resolveCategoryId({ rule, detailed, primary }, maps, fallback)`, so deleting a rule restores Plaid's category exactly.
- **One key.** Rules key on `merchant_key`: the stored generated column, and `normalizeMerchant(merchant_name ?? name)` in sync.
- **All rule writes go through `set-merchant-rule`** (JWT-verified). Clients only `select` `merchant_rules`.
- **A rule's category must be visible to the caller:** a built-in, or their own custom category.
- **Renames resolve at read time,** in the client: `display_name ?? merchant_name ?? name`.
- **UI conventions** as before. Sheets use `KeyboardAvoidingView behavior="padding"`.
- **Emulator budget.** Verify with unit tests and SQL. The emulator gets one scripted pass at the end, and no screenshot unless layout is the question.

## Review Focus

1. **A manual row under a merchant with a rule** stays put through the rule's creation, a sync, and the rule's deletion. Test: `planReresolve` skips nothing itself, since the function's query already excludes manual rows. SQL check in Task 5.
2. **Deleting the category part of a rule while a rename remains.** The row stays, with `category_id` null, and Plaid's category comes back. Test: `mergeRule`.
3. **A merchant whose key is empty** (a name with no letters). It can't take a rule or a rename: the UI hides both, and the function answers 400. Test: `validateRuleInput`.
4. **A rename of blanks, or longer than 60 characters.** 400, and the app pre-checks it. Test: `validateRuleInput`.
5. **Deleting a custom category that a rule uses** moves the rule to the group; it does not fail. SQL check in Task 5.

## Tasks

1. **Migration `20260925120000_phase7c_merchant_rules.sql`.**
   - The `merchant_rules` table exactly as in the spec, plus an `updated_at` trigger.
   - `category_id` stays `on delete restrict` (the default), so a missed step in `delete-category` fails loudly.
   - RLS: select own rows only. Grant `select` to authenticated.
   - Verify: the ACL, and that an authenticated insert is denied.
2. **Server.**
   - `_shared/rules.ts` (pure, Deno-tested):
     - `validateRuleInput(body)`, returning `RuleInput` or `{ error }`;
     - `mergeRule(existing, input)`;
     - `planReresolve(rows, ruleCategoryId, maps, fallbackId)`.
   - Extract `loadCategoryMaps(admin)` from `loadSyncContext`, so the function and sync share it.
   - New `set-merchant-rule`: 400 / 401 / 404 (category not visible) / 200 `{ ok, updated }`. Updates go in chunks of 100 ids.
   - `syncItem` loads the owner's rules once per Item and passes `rule:` to the resolver.
   - `delete-category` moves `merchant_rules.category_id` to the group before deleting the row.
   - Deploy `set-merchant-rule`, `delete-category`, `plaid-sync-transactions` and `plaid-webhook`. curl the error paths.
3. **App data.**
   - `lib/merchants.ts` (pure, node-tested): `transactionName(t, rules)` and `streamName(s, rules)`.
   - `merchant_key` is added to `TRANSACTION_COLUMNS`, `STREAM_COLUMNS` and both types.
   - Hooks: `useMerchantRules()` (a map, key `['merchant_rules']`), `useSetMerchantRule()` (invokes the function, then invalidates `merchant_rules`, `transactions`, `reports` and `recurring`), and `useTransaction(id)`.
   - `TransactionRow` and `RecurringRow` take an optional `displayName`. The feed, Recurring and Upcoming pass it.
4. **App screens.**
   - `/transaction/[id]` shows merchant plus Rename (a sheet), category plus the picker, and after a change asks "Always categorize {merchant} as {category}? …" with **Just this one** and **Always**. It also shows account, date, amount and pending.
   - The feed's tap opens this screen instead of the picker.
   - `/rules`, from Settings, lists the rules. Tapping one offers: remove the category rule, remove the rename, or delete both.
   - Both routes are registered in `_layout.tsx`.
5. **Verification** (SQL first, then one emulator script).
   - Rename a merchant: the feed, Recurring and Upcoming show it.
   - "Always": past non-manual rows follow, and a manual row does not.
   - A sync keeps the rule.
   - Deleting the rule restores Plaid's category.
   - Deleting a custom category that a rule uses moves the rule.
   - Clean up afterwards.
6. **Docs and PR:** README, CLAUDE.md, the spec's status, and a handoff.
