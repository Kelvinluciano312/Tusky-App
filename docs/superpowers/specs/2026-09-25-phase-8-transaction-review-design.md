# Phase 8: transaction review

Status: approved 2026-09-25 (Pedro). Product note: `docs/product/transaction-review.md`.

## Goal

This is a Monarch-style review flow that feels quick, even a little fun. Transactions come up one per full-screen card, in a vertical reel. On each card the user can:
- see the merchant, amount, date and account;
- write a memo;
- fix the category (Just this one / Always).

Swiping up moves to the next card, which marks the one just left as reviewed. Home shows **"N to review"**.

**Out of scope:**
- Who paid, and groups/households. Both need group ownership, which means redesigning RLS (`user_id` → group).
- Sideways swipe gestures.
- An "unreview" action.
- Showing memos in the feed.

## Decisions

| Question | Decision |
| --- | --- |
| Gesture | Vertical, full-screen paging (`FlatList` with `pagingEnabled`). No new dependencies. |
| What needs review | Every transaction added after the feature ships. Existing rows are backfilled as reviewed, so no one starts with hundreds of cards. |
| Pending rows | Not in the queue. They post under a new id, and the posted row is what gets reviewed. |
| When a card counts as reviewed | When it scrolls fully out of view upward, or when the user taps "Done" on the last card. |
| Memo | `notes`, at most 500 characters, trimmed; empty is stored as null. Saved on blur. |

## Data

Migration `…_phase8_transaction_review.sql`:

```sql
alter table public.transactions
  add column notes text check (char_length(notes) <= 500),
  add column reviewed_at timestamptz;
update public.transactions set reviewed_at = now();
create index transactions_unreviewed_idx on public.transactions (user_id, date)
  where reviewed_at is null and not pending;
grant update (notes, reviewed_at) on public.transactions to authenticated;
```

The existing owner-only UPDATE policy covers the new columns. The client can already update only `category_id` and `category_is_manual` (Phase 6), and this migration adds exactly these two columns.

## Sync: carry user data from pending to posted

Plaid posts a pending transaction as a **new** `transaction_id`. The new row's `pending_transaction_id` points at the old one, and the old one is then removed. Today that loses a manual category, and it would lose a memo too.

- The pre-read in `syncItem` (`_shared/sync.ts`) also fetches the rows whose `plaid_transaction_id` is one of the incoming `pending_transaction_id`s, and selects `notes` as well.
- For an incoming row that has **no row of its own yet**, its pending predecessor stands in as `existing`. `pickCategoryId` and `category_is_manual` then carry a manual category forward unchanged.
- **Memos are not written in the upsert.** A supabase-js bulk upsert sends the union of all rows' keys, so rows without `notes` would be set to null. After the upsert, a separate update writes the memo onto each carried row, only where the new row's `notes` is null.
- Pure logic: `carryForward(incoming, existingByPlaidId)` in `_shared/review.ts` returns the stand-in `existing` for each incoming row and the list of memo writes. Deno unit tests cover:
  - a new posted row with a manual pending predecessor;
  - a predecessor with no memo;
  - a row that already exists (no carry);
  - a missing predecessor.
- Carried rows still arrive unreviewed. `reviewed_at` is never in the sync payload.

## Client

- **`lib/review.ts`** (pure, `npm test`): `normalizeNote(text)`, which trims and maps empty to null, and a length check.
- **Queries** (`lib/queries.ts`), all under `['transactions', …]` so the existing invalidations refresh them:
  - `useReviewCount()`: a head count of rows with `reviewed_at` null, not pending, on unhidden accounts.
  - `useReviewQueue()`: the same filter, oldest first, pages of 50, `TRANSACTION_COLUMNS` plus `notes`.
  - `useMarkReviewed()` and `useSetTransactionNotes()`: optimistic, following `useSetTransactionCategory`.
- **Shared category choice.** Move the "Just this one / Always" logic from `app/transaction/[id].tsx` into a hook (`useCategoryChoice`). The transaction screen and the review card both use it.
- **`/review` screen:**
  - Full-screen pages, each a review card: merchant (renamed via `transactionName`), `Amount`, date, account, category row (opens `CategoryPicker`), memo input.
  - A header shows "3 of 12" and a close button.
  - A card is marked reviewed when it leaves view upward.
  - The end page reads "All caught up".
  - The memo field sits inside `KeyboardAvoidingView behavior="padding"`.
- **Home:** a "N to review" card under the net-worth card. It opens `/review` and is hidden at 0.
- **Transaction screen:** a Memo row with the same input.

## Verification

1. **Tests:** Deno (`carryForward`), `npm test` (`normalizeNote`), then `npm run typecheck && npx expo lint`.
2. **SQL:**
   - `has_column_privilege` is true for `notes` and `reviewed_at` and false for `amount`.
   - The unreviewed count is 0 after the push.
   - An update to another user's row changes 0 rows.
3. **Live:**
   - Fire the sandbox webhook, and new rows show up in the Home count.
   - Review a few cards: one with a memo, one recategorized with Always. `reviewed_at` is set and the count drops.
   - The memo shows on `/transaction/[id]`.
   - Checked on the emulator and on Pedro's phone.
