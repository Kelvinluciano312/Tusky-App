# Handoff — Phase 3 done (2026-09-22), and what to do next

Branch: `pedro`. Supersedes `2026-09-22-next-session-handoff.md`, whose open items are all closed
below except the hide/unhide one.

## What shipped

Budgets and cash-flow reports. Spec: `docs/superpowers/specs/2026-09-22-phase-3-budgets-reports-design.md`.

| Area | State |
| --- | --- |
| DB | `monthly_category_totals` (security_invoker view), `budgets` (first client-writable table) |
| Client | `lib/month.ts`, `lib/reports.ts` (pure), `useMonthlyTotals` / `useBudgets` / `useSetBudget` / `useDeleteBudget` |
| Screens | Budgets (stepper, summary, progress bars, edit sheet), Reports (6-month cash-flow bars, donut + ranked list) |
| Refactor | `ui/card.tsx` extracted; Home and Settings migrated onto it |

Migration `20260922180647_phase3_budgets_reports.sql` is **already pushed** to the linked project.

## Verified live (Pixel_7 emulator, test user)

The emulator is fine for all of this — no Plaid Link, so the OAuth/physical-device rule does not apply.

- Budget created through the upsert that omits `user_id` and relies on `default auth.uid()` — the
  riskiest assumption in the design, confirmed against the live DB.
- Over-budget state: $500 spent against a $400 budget rendered red, summary showed `-$100` left.
- **Cache invalidation**: recategorizing Tectra Inc ($500) from Bills & Utilities to Shopping moved
  both categories on the Budgets tab with no manual refresh. This was the flagged risk; it works.
- Month stepper: August shows its own spend, and the one budget applies there too, as designed.
- Budget delete returns the category to `NOT BUDGETED`.
- Reports: donut and bars render, Apr/May (no data) draw as gaps rather than holes.
- Transfers excluded — the sandbox user has a $1,000 CD deposit and a $5,850 ACH that correctly stay
  out of both cash-flow bars.
- Unauthenticated `curl` against the view returns `[]`, and an anon insert into `budgets` is rejected
  with `42501`. (Note: `anon` *does* hold table-level select here via this project's older default
  privileges — same as `transactions` — so RLS, not the grant, is what returns zero rows.)

Nothing was left changed: the recategorization was reverted and the test budget deleted.

## Known edge, not a bug

The donut's centre total and the cash-flow bar for the same month can disagree. `buildCategorySlices`
drops any expense category whose month is net-negative (refunds exceeded spend) because a negative arc
cannot be drawn, while `buildCashFlow` keeps it. In the sandbox data a $500 United Airlines refund
makes September read `$3,793.13` in the donut and `$3,293.13` in the bars. Only visible when a
category nets negative over a whole month. Fixing it means choosing which number is "spent"; neither
is wrong, so it was left alone.

## Open items

- **Hide/unhide toggle still does not exist in the app** (only settable via SQL). When it is added it
  must invalidate `['transactions']`, `['accounts']` **and `['reports']`** — the view filters hidden
  accounts in SQL, so a stale reports cache would disagree with Home.
- Income bars are visually tiny whenever one expense category dominates (loan payments here). The
  scale is relative to the window's peak. Worth revisiting only if it reads as broken with real data.
- No test runner exists in `apps/mobile`, so `lib/reports.ts` — which is pure and the natural place
  for unit tests — has none. Adding `jest-expo` is its own decision.
- `plaid-sync-transactions` still does not refresh balances; only `plaid-exchange-token` writes them.
  The stale comment saying otherwise is now corrected, but the gap is real and blocks net-worth history.

## Next: Phase 4 — net worth history

The README's next phase. It needs what Phase 3 could not use: a record of balances over time.
`accounts.current_balance` is written only at link time, so today's number is a snapshot and there is
nothing to plot. Likely shape: a `balance_snapshots` table written by the sync path, plus the same
kind of `security_invoker` view. Brainstorm it before building.

Also additive and cheap whenever wanted: `categories.group_id` (Monarch-style groups), and per-month
budget overrides — a nullable `month` column plus `unique nulls not distinct (user_id, category_id,
month)`.
