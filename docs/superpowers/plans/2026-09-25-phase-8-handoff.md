# Handoff: Phase 8 done, transaction review (2026-09-25)

Branch `pedro-8`, off `master` (with #8 and #9 merged). Spec: `docs/superpowers/specs/2026-09-25-phase-8-transaction-review-design.md`.

## What shipped

**DB.** Migration `20260925150000_phase8_transaction_review.sql` (pushed):
- `transactions.notes` (trimmed, 1–500 characters, or null) and `reviewed_at`;
- every existing row backfilled as reviewed (498 rows);
- partial index `transactions_unreviewed_idx`;
- `grant update (notes, reviewed_at)` to authenticated.

**Functions.**
- `_shared/review.ts` `carryForward`: when a pending row posts under a new id, the posted row inherits the pending row's manual category (via `pickCategoryId`) and its memo. Memos are written by a separate update after the upsert, because a bulk upsert sends the union of keys and would null every other row's memo.
- Deployed: `plaid-sync-transactions`, `plaid-webhook`, `set-merchant-rule` (all bundle `sync.ts`). The first `set-merchant-rule` deploy returned a Supabase-side 500; the retry succeeded.

**Client.**
- `/review`: a vertical paged `FlatList`, one transaction per page, with category (via the shared `useCategoryChoice`) and memo (`NoteSheet`). Swiping past a card marks it reviewed; `leftBehind` catches flings.
- Home "N to review" card, hidden at 0.
- Memo row on `/transaction/[id]`.
- `DetailLine` extracted from the transaction screen.

**Tests.** Deno 91 (was 87). App 26 (was 23).

## Verified live (emulator)

- Grants: `notes` and `reviewed_at` UPDATE true, `amount` false. 0 unreviewed after the push.
- 5 of the test user's rows set unreviewed by SQL:
  - Home showed "5 to review";
  - the reel went "1 of 5" … "All caught up";
  - a memo saved on card 1 and showed on `/transaction/[id]`;
  - the category dialog opened on card 2 and was cancelled;
  - all 5 rows had `reviewed_at` set, and the Home card was gone.
- Test memo cleared afterwards. Manual rows untouched.

## Things to know

- **Queue snapshot.** The queue is snapshotted once per visit (`['review-queue']`, deliberately outside `['transactions']`). Cards read live rows through `useTransaction`. It holds at most 200 ids; reopen for more.
- **Pending rows are never in the queue.** Their posted twin is reviewed instead.
- **Not exercised live:** `carryForward` on real pending → posted data (Sandbox rarely does it on demand). It is unit-tested, and the sync path type-checks.
- **Remote phone testing** (Tailscale plus a firewall rule) is documented in CLAUDE.md.
- **Deferred:** who paid and groups/households (need the RLS redesign), memos in the feed, "unreview".
