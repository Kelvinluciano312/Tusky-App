# Handoff — state at end of 2026-09-20, and what to do next

Branch: `feature/mobile-app`. Everything below is committed and pushed unless noted.

## Where the project is

Phases 0–2 are done and verified on a real device against Plaid Sandbox. Phase 2.5 is half
done: Link update mode is finished; webhooks are not started.

| Area | State |
|---|---|
| Schema | `categories` (16), `plaid_category_map` (16), `transactions`, `plaid_items.sync_locked_at` |
| Edge Functions | `plaid-create-link-token` (update mode), `plaid-exchange-token` (upserting), `plaid-sync-transactions`, `plaid-sandbox-reset-login` (dev only) |
| App | Transactions feed, category picker, Settings reconnect |
| Verified live | 51 transactions synced, 0 uncategorized, sign convention, manual override surviving re-sync, `ITEM_LOGIN_REQUIRED` detect → reconnect → recover with no duplicate Item |

Specs and plans: `docs/superpowers/specs/2026-09-20-phase-2-transaction-sync-design.md`,
`docs/superpowers/plans/2026-09-20-phase-2-transaction-sync.md`.

## Start here: two data problems in the live database

These are data state, not code. Neither blocks development, both make the app look wrong.

### 1. Duplicate Chase Item, duplicating every transaction

Two `plaid_items` rows both point at the same Chase login:

| Item | Created | Accounts | Transactions |
|---|---|---|---|
| `b63909d4-e18b-400d-bf0d-b1668f533919` | 2026-07-09 | 12 (all hidden) | 92 |
| `91d9dfaf-0514-4bda-90b1-6c127e9c5f8d` | 2026-09-20 | 14 | 51 |

The July Item was created before update mode existed; a reconnect that day made the second one.
Both were later repaired, so both are now `active` and both sync — producing **51 duplicate
transaction groups** (same name, date and amount from two Items with different Plaid ids).

Its 12 accounts are hidden, so net worth is correct, but the transaction feed shows every
transaction twice.

**Fix:** delete the July Item. `accounts` and `transactions` both cascade on `item_id`.

```sql
delete from public.plaid_items where id = 'b63909d4-e18b-400d-bf0d-b1668f533919';
```

Run it with `npx supabase db query --linked "..."`. An agent session may have destructive SQL
blocked by the harness — if so, hand it to the user rather than working around it.

Update mode means this cannot recur: reconnecting now repairs in place.

### 2. The feed ignores `accounts.hidden`

Hiding an account removes it from net worth (Home filters `!hidden`) but its transactions still
appear in the feed. That is inconsistent on its own terms, independent of the duplicate Item.

Decide which is intended — Monarch hides both — then either filter `useTransactions` by a join on
non-hidden accounts, or drop `hidden` from the feed deliberately and document why. Fixing the
duplicate Item above hides the symptom but not this gap.

## Next feature: webhooks (Phase 2.5, second half)

The remaining half of 2.5, and what the README calls Phase 2's last piece. The sync engine was
shaped for it: the per-item routine is already the reusable unit, and the `sync_locked_at` claim is
what makes a webhook-triggered sync safe to overlap with a pull-to-refresh.

Needs, roughly:

- A **public, unauthenticated** Edge Function — Plaid calls it, not a signed-in user. This is the
  first endpoint in the project without `getAuthedUser`, so it needs its own protection: verify Plaid's
  JWT via `/webhook_verification_key/get`, and reject anything that fails.
- Handle `SYNC_UPDATES_AVAILABLE` (the useful one for `/transactions/sync`), plus `ITEM_ERROR` /
  `PENDING_EXPIRATION` to mark Items `login_required` without waiting for a user-triggered sync.
- Register the webhook URL on `linkTokenCreate` (a `webhook` field) and via `/item/webhook/update`
  for existing Items.
- Sandbox fires webhooks only on demand: `/sandbox/item/fire_webhook`. Add it to the dev helper
  alongside `reset_login`, and test with the same break-and-observe cycle.

Brainstorm it properly (architectural — new public surface, new trust boundary) rather than
extending the sync function ad hoc.

## Then: Phase 3

Budgets and cash-flow reports, which is what `categories.kind` (income/expense/transfer) was added
for. `budgets.tsx` and `reports.tsx` are still `EmptyState` stubs. Monarch nests categories under
groups; adding `categories.group_id` later is purely additive and does not touch `transactions`.

## Gotchas worth re-reading before starting

All in `CLAUDE.md`, all learned the hard way today:

- Supabase Free Plan pauses after ~7 days idle and presents as a Cloudflare **521**, which looks
  like a dead key or a broken network and is neither.
- `options.transactions_url_taxonomy` is rejected by `plaid@30` with `UNKNOWN_FIELDS`. Plaid's docs
  describe the current API, not the version the SDK pins.
- `plaid-sandbox-reset-login` must never be exposed in production. Two guards; keep both.

## Testing notes

- Device verification is what caught every real bug today; typecheck and lint caught none of them.
  A Pixel 10 Pro is paired over wireless adb — `adb exec-out screencap -p > out.png` and read the
  image rather than inferring from logs.
- `adb shell input swipe` needs ~900ms to register as a pull-to-refresh; 400ms silently does nothing.
- Query the database to confirm behaviour, but scope the query. Two wrong conclusions today came
  from reading truncated output of an unscoped query.
