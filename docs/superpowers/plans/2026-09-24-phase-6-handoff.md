# Handoff — Phase 6 done, key switch pending (2026-09-24)

Branch: `pedro`. Supersedes `2026-09-23-phase-5-handoff.md`.
Spec: `docs/superpowers/specs/2026-09-23-phase-6-connections-control-design.md`.
Plan: `docs/superpowers/plans/2026-09-24-phase-6-connections-control.md`.

## What shipped

| Area | State |
| --- | --- |
| DB | Two migrations, both **pushed**. `20260924120000`: `plaid_items_status_check` (`active \| login_required \| archived`). `20260924120100`: revokes everything from anon/authenticated on the nine older relations and re-grants what the app uses. It also revokes `postgres`'s default privileges in `public`, so new tables get nothing until granted. |
| Functions | `_shared/connections.ts`: pure `planDisconnect`, `isItemGone`, `isDuplicateLink`, plus `disconnectItem`. New `plaid-disconnect-item` (JWT-verified). `_shared/sync.ts` exports `claimItem`, which never claims an archived Item, and its snapshot skips archived banks. `plaid-exchange-token` refuses duplicates before the exchange (409 `duplicate`). Deployed: `plaid-disconnect-item`, `plaid-exchange-token`, `plaid-sync-transactions`, `plaid-webhook`. |
| Client | `/bank/[id]` screen: status line, a "Show in Tusky" switch per account, Disconnect (Keep history / Delete everything, which asks twice) or Delete history, and the `__DEV__` tools moved here from Settings. Settings lists live banks as rows, plus a **Disconnected** section. Home's account rows open the bank screen. New hooks: `useItemAccounts`, `useSetAccountHidden`, `useDisconnectBank`. One `readFunctionError` helper. |
| Fix | Accounts share a `created_at` (one upsert), and ties came back in physical order. Hiding an account made it jump to the top of the list. Both account queries now tiebreak on `name, id`. |

## Verified live (Pixel_7 emulator, test user)

- 70 Deno tests pass: 54 existing, 15 connections, 1 snapshot. `npm run typecheck` and `npx expo lint` are clean.
- **Grants.**
  - `anon` appears on no public relation.
  - The `postgres` defaults list only `postgres` and `service_role`.
  - Anon `GET /transactions` returns 401 `42501`.
  - With a user JWT, these each return 403 `42501`: `PATCH transactions.amount`, `PATCH accounts.current_balance`, `SELECT plaid_category_map` and `INSERT plaid_items`.
- **Regression pass under the new grants** (all fine): feed, recategorize and revert, budget set and remove, Reports, the Home chart, recurring dismiss and restore.
- **Hide/unhide** on Chase Money Market ($43,200):
  - the hero went from −$104,164.15 to −$147,364.15, matching the chart's last point;
  - 21 → 20 accounts;
  - its GUSTO transactions left the feed;
  - unhiding restored everything.
- **Duplicate guard.** Relinking First Platypus as `user_transactions_dynamic` showed "First Platypus Bank is already connected…" and created no row.
- **Keep history** on First Platypus:
  - status `archived`, token gone;
  - 349 transactions kept and still in the feed;
  - 0 streams and 0 of today's snapshots; 7 past snapshots kept;
  - Home dropped to 14 accounts, and the hero equals the chart's last point (−$77,164.15);
  - a later sync updated Chase and left Platypus untouched, with no new snapshot for it;
  - Settings lists it under Disconnected.
- **Relinking after an archive is allowed** (same user, same accounts).
- **Busy guard.** With `sync_locked_at = now()`, Delete everything showed "This bank is syncing — try again in a moment." and nothing changed.
- **Delete everything** on that relink removed the Item, token, accounts and transactions, left no orphaned snapshots, and did not touch the archived Platypus.
- **Delete history** (`delete_local`) on a `user_good` Platypus link that had been archived first: the row is gone.
- **Function error paths:**
  - 400 for a non-UUID `item_id`, a bad mode, or no body;
  - 404 for another user's Item or an unknown UUID;
  - 200 no-op for archiving an archived Item.

The spec's "Delete everything on the duplicate Chase" target no longer existed at the start of this session: someone had removed that Item already. That path was tested on a fresh Platypus link instead. Every test link was cleaned up.

## Current data (after this session)

| User | Item | Status | Accounts | Transactions |
| --- | --- | --- | --- | --- |
| test user `ccbd42ef-…` | Chase (OAuth), linked 09-20 | active | 14 | 53 |
| test user | First Platypus (`user_transactions_dynamic`), linked 09-23 | **archived** | 7 | 349 |
| `33c789b7-…` | Chase, linked 09-22 | login_required | 14 | 48 |

## Not done: the Plaid key switch (needs Pedro's go-ahead)

This is the spec's "Final step". Nothing about it has been started, and `supabase/functions/.env` still holds Kelvyn's keys, unpushed. Remaining, in order:

1. While the old keys still work, **Delete everything** on the test user's Chase (09-20), from its bank screen.
2. **Decide about `33c789b7-…`'s Chase.** Either its owner disconnects it in the app first, or it gets deleted by SQL afterwards. It is `login_required`, but `/item/remove` works regardless.
3. In Kelvyn's Plaid dashboard, add `com.tusky.app` under Allowed Android package names.
4. `npx supabase secrets set --env-file supabase/functions/.env`, only at this step. `PLAID_ENV` stays `sandbox`.
5. Relink First Platypus on the emulator (proves an archived Item doesn't block). Then run **Delete history** on the archived one (the `delete_local` path, with no Plaid call).
6. Relink Chase on a phone (OAuth needs an arm64 build). Sync, then fire the dev webhook.
7. Record the switch here and in project memory, and retire the `--env-file` warning in CLAUDE.md.

## Known, accepted

- **Reconnecting a kept bank** creates a new connection, whose first 90 days overlap the kept history until the old one is deleted.
- **Net worth steps on the disconnect day.** Kept history still counts on earlier days.
- **An Item whose token died another way** (keys switched first, wrong `PLAID_ENV`) cannot be removed from the app, since every `/item/remove` fails. That is ops cleanup.
- **The duplicate check trusts Link's metadata as the client sends it.** Bypassing it only duplicates the caller's own data.
- **`disconnectItem`'s I/O has no unit tests** (the repo has no DB mock); it is covered by the live pass above. `apps/mobile` still has no test runner.
- **The connect error persists.** Settings keeps the last connect error (e.g. "already connected") on screen until the next connect attempt, even after that bank is disconnected.

## Open items

- A bank-count tier limit belongs in `plaid-exchange-token` (monetization phase). The same phase owns idle-bank auto-archive, via `disconnectItem(…, 'archive')`.
- Categories phase (groups, custom categories, rules, merchant renaming): see the spec's Deferred section.
