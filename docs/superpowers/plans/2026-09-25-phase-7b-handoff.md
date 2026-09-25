# Handoff — Phase 7b done: custom categories and built-in overrides (2026-09-25)

Branch: `pedro-7b`, stacked on `pedro` (PR #6, 7a). Supersedes `2026-09-24-phase-7a-handoff.md` for Phase 7 state. Phase 6's key-switch steps (in `2026-09-24-phase-6-handoff.md`) are still pending, and wait on Pedro's go-ahead.

- Spec: `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md` (Milestone 7b).
- Plan: `docs/superpowers/plans/2026-09-24-phase-7b-custom-categories.md`.

## What shipped

| Area | State |
| --- | --- |
| DB | Migration `20260924210000_phase7b_custom_categories.sql`, **pushed**. <ul><li>`category_overrides` (per-user name, colour and hidden for built-ins; a trigger refuses custom rows; own-rows RLS; `arwd` to authenticated).</li><li>`categories`: name 1–40 characters after trimming, colour `#RRGGBB`, and `sort_order` defaults to 1000, so custom rows sort last.</li><li>Clients may insert their own rows, and update their name, icon and colour, through column grants plus insert/update policies.</li><li>The `user_categories` view: `security_invoker`, a redundant `auth.uid()` predicate, and an `overridden` flag.</li></ul> |
| Functions | New `delete-category` (JWT-verified). It moves the category's transactions (manual flags kept) and recurring streams to its group, deletes its budget, then deletes the row. The pure checks are `readCategoryId` and `planCategoryDelete` in `_shared/categories.ts`. `loadSyncContext` now loads built-ins only; `syncItem` adds the owner's custom transfer categories before recurring detection. Deployed: `delete-category`, `plaid-sync-transactions`, `plaid-webhook`. |
| Client | <ul><li>`useCategories` reads `user_categories`; `Category` gains `hidden`, `is_custom` and `overridden`, and `slug` becomes nullable.</li><li>Hooks: `useCategoryOverride` (optimistic on hidden; a null patch resets), `useCreateCategory`, `useUpdateCategory`, `useDeleteCategory`, and `countCategoryTransactions`.</li><li>`lib/categories.ts`: `withoutHidden`, `pickerSections`, `validateCategoryName`, `changedFields`, `deleteCategoryMessage`, `SWATCHES` and `CUSTOM_ICONS`.</li><li>The picker and Budgets' suggestions skip hidden categories. The picker keeps the current selection.</li><li>New `/categories` screen (Settings → "Rename, hide or add categories") and `CategorySheet`.</li><li>`readFunctionError` moved to `lib/functions.ts`.</li></ul> |
| Fix | The category sheet and the budget sheet (the latter since Phase 3) were fully covered by the Android keyboard: a `Modal` is its own window, so the activity's keyboard resize never reaches it. Both now wrap their content in `KeyboardAvoidingView behavior="padding"`. |
| Tests | Deno: 80 (was 73). App `npm test`: 19 (was 13). |

## Verified live (Pixel_7 emulator, test user)

- **Grants.** Authenticated may update `name` but not `parent_id`, and may insert `parent_id` but not `kind` or `slug`. It has no delete on `categories`. Anon cannot read `user_categories`.
- **As users** (SQL with simulated JWT claims, rolled back).
  - A custom insert gets `kind=expense` and `sort_order=1000`, and the other user sees it 0 times.
  - Naming `kind` → 42501. Updating `parent_id` → 42501. A blank name → 23514.
  - A direct edit of a built-in changes 0 rows.
  - The view applies an override, and an override on a custom row is refused.
- **`delete-category` with a real JWT.** A malformed id → 400. A built-in id → 404. A random UUID → 404. No auth → 401.
- **Sync** after deploy: clean. 12 streams were refreshed through the per-user transfer query.
- **Hide.**
  - Coffee Shops and the Entertainment group left the picker and Budgets' "Show all" list.
  - A hidden Fast Food still showed in Chipotle's picker, because it was the selection, and was gone from other transactions' pickers.
  - Reports still counted hidden Entertainment ($837.41).
- **Rename.** Groceries → "Supermarket", with a blue swatch: the override row had exactly those, and the feed showed "Supermarket". Reset deleted the row.
- **Custom round trip.**
  - Added "Date night" under Food & Dining, assigned it to a Dunkin' transaction (manual), and gave it a $40 budget.
  - Delete confirmed "Moves its 1 transaction to Food & Dining, and removes its budget.".
  - Afterwards the transaction was on `food_and_dining`, still manual; the category and its budget were gone.
  - Reverted the transaction afterwards.
- **After cleanup.** 0 overrides and 0 custom categories. The manual checksum is unchanged (`997c59d0…`), and the budgets are the original 4.

## Things to know

- **Dev-only reload when typing.** `adb shell input text` with two "r"s inside 200 ms (for example "Supermarket") reloads a dev build when the field is in a `Modal`. React Native's double-tap-R check looks at the activity's focus, not the dialog's. Type in chunks. Release builds are unaffected.
- **Deferred minors.**
  - Hiding and then unhiding a built-in leaves an override row with every field at its default, so "Reset to default" still shows for it. Harmless.
  - A transaction could be pointed at another user's custom category id (the FK check bypasses RLS). That would make the owner's delete fail with a 500. It needs an unguessable UUID, so the risk is low.
  - Carried from 7a: the categories cache lasts 1 hour after a taxonomy migration, and Budgets `save()` deletes the replaced budgets before it upserts.

## What 7c needs (merchant rules and renaming)

- **`delete-category`** gains a step before the row delete: move `merchant_rules.category_id` to the group. Keep `merchant_rules.category_id` `on delete restrict`, so a missed step fails loudly.
- **`set-merchant-rule`** must accept a category the caller can see: a built-in, or their own custom row. Check the id against `categories` with `user_id is null or user_id = caller`.
- **Sync** already loads per-Item data (the owner's transfers). Load the owner's rules in the same place.
- The rename sheet should follow `category-sheet.tsx`, which uses `KeyboardAvoidingView`.
