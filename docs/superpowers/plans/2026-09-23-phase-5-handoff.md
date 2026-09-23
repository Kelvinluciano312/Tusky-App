# Handoff — Phase 5 done (2026-09-23)

Branch: `pedro`. Supersedes `2026-09-22-phase-4-handoff.md`.
Spec: `docs/superpowers/specs/2026-09-23-phase-5-recurring-bills-design.md`.
Plan: `docs/superpowers/plans/2026-09-23-phase-5-recurring-bills.md`.

## What shipped

| Area | State |
| --- | --- |
| DB | `recurring_streams` (service-role writes; clients `select` + `update (dismissed)` only). Migrations `20260923180000` and `20260923181000` **pushed**. |
| Functions | `_shared/recurring.ts` — pure `detectStreams` / `staleStreamIds` + `refreshRecurring`, called last in `syncItem`. `plaid-sync-transactions` and `plaid-webhook` **deployed**. |
| Client | `useRecurringStreams`, `useSetStreamDismissed`, `lib/recurring.ts`, Home "Upcoming · next 14 days" card, `/recurring` screen (Bills & subscriptions, Income, Not recurring). |
| Fix | Home's net-worth window was memoized at mount and froze across midnight; now derived per render, and Home's pull-to-refresh refetches history and streams too. |

## Verified live (Pixel_7 emulator, test user)

- Phase 4 close-out: see the spec's first section (sparkline, `login_required`, multi-Item carry-forward).
- 54 Deno tests pass (32 existing + 22 detector, two added after the final review for the month-boundary anchor).
- A sync detected 18 streams across both Items — Netflix, Spotify, OpenAI, card payments, and Chase's
  sandbox fixtures, which genuinely repeat monthly.
- Home card: Uber (Fri 25) and United (Mon 28), total -$505.40 — matched the table.
- Recurring screen: "$4,462.92 a month in recurring bills", bills and income sections.
- "Not recurring" on Netflix survived a two-Item sync (row re-upserted, `dismissed` still true); Restore
  in the UI set it back.
- Hiding the Platypus credit card removed its two streams (Netflix, OpenAI) from the screen; unhidden after.
- Anon `GET` → 401 `42501`; anon `PATCH` → 401. `authenticated` can update `dismissed` but not `name`,
  and cannot insert.

## Found on the way — read this

**Column grants in this project restrict nothing on their own.** Default privileges give `anon` and
`authenticated` every privilege on each new public table. `recurring_streams` now revokes them first
(`20260923181000`). **Older tables still have them**: RLS keeps users to their own rows, so there is no
cross-user leak, but e.g. a client can `UPDATE transactions SET amount = …` on its own rows despite the
Phase 2 comment. Worth a follow-up migration that revokes and re-grants per table. CLAUDE.md now says so.

## Known, accepted

- A user whose *only* Item is `login_required` gets no balance snapshot that day (a gap).
- A monthly bill whose third charge falls just outside the 90-day link window is not detected until
  its next charge. Raising `days_requested` at link is a monetization decision.
- No annual, quarterly or semi-monthly cadence; semi-monthly paychecks classify as biweekly, ±3 days.
- A price jump beyond tolerance breaks the run until three new charges; a subscription that moves
  cards is one ended stream plus one new one.
- A dismissed stream that stops qualifying is kept forever.
- No tier gating yet.
- Sandbox data is odd in places (e.g. "Sweetgreen" as a weekly $810 inflow) — that is the fixture, not
  the detector.

## Open items

- The hide/unhide toggle still does not exist; when added it must invalidate `['transactions']`,
  `['accounts']`, `['reports']`, `['net_worth']` **and `['recurring']`**.
- No test runner in `apps/mobile`; `lib/recurring.ts`, `lib/reports.ts` and the sparkline math are
  untested.
- `plaid-exchange-token` persists the Item before `syncAccounts` (from Phase 4).
- Plaid key switch (planned after Phase 5): new keys invalidate every access token, so both sandbox
  Items must be relinked. Old `plaid_items` rows would stay, with dead tokens, and keep their
  accounts, transactions, snapshots and streams. Delete or archive them deliberately rather than
  leaving them `active`, or every sync logs errors for them.

## Test data

The test user has two Items: Chase (OAuth — test Link for it on a phone, never the emulator) and First
Platypus Bank / `user_transactions_dynamic` (non-OAuth; use it for `Break (dev)` on the emulator).
Verification SQL: `npx supabase db query --linked`, keyed on
`user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'`, never joining `auth.users`.
