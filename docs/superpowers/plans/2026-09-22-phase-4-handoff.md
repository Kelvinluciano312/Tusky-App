# Handoff — Phase 4 done (2026-09-22)

Branch: `pedro`, pushed to `origin` through `7b57afa`. Supersedes `2026-09-22-phase-3-handoff.md`.

Spec: `docs/superpowers/specs/2026-09-22-phase-4-net-worth-history-design.md`.

## START HERE NEXT SESSION

The session ended on a usage limit, not at a natural stopping point. Phase 4 is **written, deployed
and partly verified** — the backend is proven, the chart is not. Do these in order before starting
anything new.

**1. Watch the sparkline actually render.** This is the only Phase 4 deliverable never seen working.
It needs two distinct dates in `balance_snapshots` and on 2026-09-22 only one existed, so the
component correctly hid itself — which looks identical to it being broken. Either sync again on a
later day, or insert a synthetic row for an earlier date as the service role. Three things to confirm
once it draws: that the line is in chronological order (the `.order('date')` in `useNetWorthHistory`
is what prevents a scribble — verify it rather than assume it); that the 90-day change figure beside
it reads correctly and carries its sign; and that the `max === min` flat-line guard in
`charts/sparkline.tsx` draws a mid-height line rather than nothing, which needs two equal balances on
two dates to force.

**2. Verify the `login_required` path.** Settings → `Break (dev)`, then sync. The swallowed
`accountsGet` error must **not** steal the classification: the Item must still end up
`login_required` and Settings must still offer Reconnect. If that regressed, the swallow in
`_shared/sync.ts` is the place to look. This is the highest-risk untested path in the phase, because
it is the one where two error handlers could fight.

**3. Confirm a snapshot is still written on that broken-Item sync** — from last-known balances, one
row per account. That is the deliberate carry-forward; if it is missing, the chart will gap.

Only after those: Phase 5 is recurring transactions and bills radar. Brainstorm before building.

### Verify before trusting anything here

`adb shell input swipe` at 900ms did **not** trigger pull-to-refresh on this emulator; 1200ms starting
at y=900 did. A sync that never ran produced an empty table that looked exactly like a broken feature
for several minutes. **Screenshot the refresh spinner and confirm `plaid_items.updated_at` moved
before concluding anything about sync-driven behaviour.**

## What shipped

| Area | State |
| --- | --- |
| DB | `balance_snapshots` (service-role writes, select-only for clients), `daily_net_worth` view |
| Functions | `_shared/accounts.ts` — `syncAccounts` + pure `buildSnapshotRows`, used by `plaid-exchange-token` and `syncItem` |
| Client | `useNetWorthHistory`, `charts/sparkline.tsx`, trend line + 90-day change on Home |

Migration `20260922184601_phase4_net_worth_history.sql` is **already pushed**, and
`plaid-sync-transactions`, `plaid-webhook`, `plaid-exchange-token` are **already deployed**.

## Two pre-existing bugs fixed as a side effect

1. **Balances were never refreshed** — `plaid-exchange-token` was the only writer, so Home's hero was
   frozen at link time. `syncItem` now refreshes on every sync.
2. **A newly-opened account's first transactions were lost permanently.** `syncItem` filtered
   transactions against accounts it already knew and advanced the cursor anyway, and Plaid never
   re-delivers an `added` item. `syncAccounts` now runs *before* that map is built, so the account
   exists by the time the filter runs. This is the stronger reason the refresh goes where it does.

## Verified live (Pixel_7 emulator, test user)

- Pull-to-refresh → `plaid_items` and `accounts.updated_at` both moved, so the refresh ran.
- **`daily_net_worth` for today returned `-77164.15`, exactly matching Home's `-$77,164.15`.** That
  equality is the feature's correctness test: it proves the view's credit/loan sign flip and hidden
  filter mirror `signedBalance` and Home's filter.
- 32 Deno tests pass, including 7 new ones pinning `buildSnapshotRows` (null balance coalesced to 0,
  no account dropped, deterministic sort, `date` omitted for the column default).
- Unauthenticated reads of the view and table return `[]`; an anon insert is rejected `42501`.

## Not yet verified — pick this up first

- **The sparkline has never rendered.** It needs two distinct dates and only one day exists. Insert a
  synthetic row for an earlier date as the service role, or re-check tomorrow, and confirm the line
  draws in chronological order and the 90-day change reads correctly.
- **The `max === min` flat-line guard** is untested for the same reason.
- **The `login_required` path** (verification step 5 in the plan): the swallowed `accountsGet` error
  must not steal the `login_required` classification — Settings should still show Reconnect. Use
  `Break (dev)` in Settings.

A testing note worth keeping: `adb shell input swipe` at 900ms did **not** trigger pull-to-refresh
here; 1200ms starting at y=900 did. Always confirm the spinner in a screenshot before trusting that a
sync ran — an absent result looked identical to a broken feature for several minutes.

## Known, accepted

- A `login_required` Item keeps contributing its last known balance to every daily snapshot — a
  deliberate carry-forward. Skipping it would make the day partial and sawtooth the chart.
- Connecting a bank creates a step: new accounts have no rows for prior dates.
- A closed account keeps contributing a frozen balance forever. Pre-existing, but snapshotting turns a
  one-off wrong number into a permanent flat line. Wants a `closed_at` column; its own change.
- Snapshot dates are UTC (`current_date`); there is no user timezone in the schema.
- The donut/cash-flow discrepancy from Phase 3 is unchanged and still documented there.

## Open items carried forward

- **Hide/unhide toggle still does not exist in the app.** When added it must invalidate
  `['transactions']`, `['accounts']`, `['reports']` **and now `['net_worth']`**.
- No test runner in `apps/mobile`; `lib/reports.ts` and the sparkline math remain untested.
- `plaid-exchange-token` persists the Item and access token *before* `syncAccounts`, so a transient
  failure there leaves a billable Item with zero accounts. Pre-existing; worth a follow-up.
