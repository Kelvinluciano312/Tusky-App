# Handoff — state at end of 2026-09-22, and what to do next

Branch: `pedro` on `Kelvinluciano312/Tusky-App` (the old `DahVincis` fork is archived).

## Where the project is

Phases 0–2.5 are done. Phase 2.5 finished today: Plaid webhooks.

| Area | State |
| --- | --- |
| Edge Functions | `plaid-create-link-token` (registers webhook), `plaid-exchange-token`, `plaid-sync-transactions`, `plaid-webhook` (public), `plaid-sandbox` (dev only) |
| Shared | `_shared/sync.ts` (`syncItem`, used by both sync paths), `_shared/webhook.ts` (verification + routing, 15 tests) |
| App | Refetch on foreground (`focusManager`), feed hides hidden accounts, `Webhook (dev)` + `Break (dev)` in Settings |

Spec: `docs/superpowers/specs/2026-09-22-plaid-webhooks-design.md`.

## Verified live today (test user, Pixel_7 emulator unless noted)

- An unsigned, garbage or forged POST to `plaid-webhook` gets our own 401; GET gets 405.
- Pull-to-refresh through the refactored sync: new transaction synced, 0 duplicates, manual
  category kept, lock released.
- `Webhook (dev)`: the Item synced 4s later with no app-side sync — a real Plaid-signed JWT passed.
- `Break (dev)`: the Item went `login_required` 8s later from the ITEM ERROR webhook alone; after
  backgrounding and reopening, Settings showed "Sign-in expired" + Reconnect.
- Hiding the credit card removed its 22 transactions from the feed and $410 from net worth.
- Reconnect through Link update mode (**Pixel 10 Pro**): Item back to `active`, still one Item, 52
  transactions, manual override intact. Link accepted `webhook` alongside `access_token`.

Nothing is left broken: the Item the `Break (dev)` test knocked over was reconnected.

## Gotcha: Plaid Link OAuth does not survive the emulator

On the Pixel_7 emulator, Link's webview loses its `link/workflow/poll` requests while Chrome holds
the Chase OAuth page, then comes back to a blank screen — twice, reproducibly. The same flow works
on the Pixel 10 Pro. **Test any Link flow for an OAuth bank on the phone.** Non-OAuth paths are fine
on the emulator.

Also, the emulator auto-ticks the OAuth account checkboxes and the phone does not, so on the phone
all 14 must be ticked by hand or Continue stays disabled.

Not observed either way: whether Plaid fires `LOGIN_REPAIRED` after update mode. It is routed to a
sync, and the app syncs on Link success anyway, so nothing depends on it.

## Open items, small

- `useSyncTransactions`' comment says a sync refreshes balances. It does not: balances are only
  written by `plaid-exchange-token`. `/transactions/sync` returns `accounts` with balances in newer
  Plaid versions — check what `plaid@30` pins before relying on it.
- When a hide/unhide toggle is added to the app, it must invalidate `['transactions']` as well as
  `['accounts']`.
- Accepted gap: a webhook arriving mid-way through an app-triggered sync of the same Item is
  `skipped` by the claim; the next webhook or refresh catches up.

## Next feature: Phase 3

Budgets and cash-flow reports, which is what `categories.kind` (income/expense/transfer) was added
for. `budgets.tsx` and `reports.tsx` are still `EmptyState` stubs. Monarch nests categories under
groups; adding `categories.group_id` later is purely additive and does not touch `transactions`.
Brainstorm it before building.

## Testing notes

- Android builds need JDK 17 (see CLAUDE.md): Android Studio's `jbr` is now JDK 25 and breaks
  `configureCMakeDebug`.
- `npx -y deno test supabase/functions/_shared/` runs the function tests without installing Deno.
- Device verification caught the real bugs again; typecheck, lint and unit tests did not.
- `adb shell input swipe` needs ~900ms to register as a pull-to-refresh, and on Home it only
  refetches — sync happens from the Transactions tab.
