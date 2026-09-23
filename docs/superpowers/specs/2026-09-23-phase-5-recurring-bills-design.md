# Phase 5 — Recurring transactions and bills radar (design)

Status: approved 2026-09-23. Extends Phase 4.

Tusky knows every transaction but not which ones come back. This phase finds the ones that do —
subscriptions, bills, paychecks — predicts the next date, and puts what is due soon on Home. Scope,
detection source and placement were chosen in brainstorming: **core radar + price flags, our own
detection, a Home card plus a Recurring screen.**

## Phase 4 close-out (verified 2026-09-23, emulator)

Done before any Phase 5 code, per the Phase 4 handoff:

- **Sparkline renders.** Two equal days (-$77,164.15) drew a flat mid-height line and "$0.00 over 90
  days" — the `max === min` guard works. After linking First Platypus Bank (`user_transactions_dynamic`,
  7 accounts, 331 transactions) the line ran left-to-right from -$77,164 to -$104,164, the change read
  "-$27,000.00", and the hero equalled `daily_net_worth` for the day.
- **`login_required` path holds.** `Break (dev)` on the Platypus Item, then a sync: "A bank needs to be
  reconnected in Settings." (so `syncItem`, not only the webhook, classified it) and Reconnect in
  Settings. Update mode repaired it on the emulator (non-OAuth); status back to `active`.
- **Carry-forward holds, in its multi-Item form.** With today's Platypus snapshot rows deleted, the
  post-break sync restored all 7 — written by the healthy Chase Item's sync.
- **Correction to the Phase 4 handoff:** a user whose *only* Item is `login_required` gets **no** row
  that day. `syncItem` throws `HANDLED` before the snapshot block (`_shared/sync.ts`). That is a gap,
  consistent with the Phase 4 spec's "a gap is honest" rule. Accepted.
- **New bug found:** Home memoizes its 90-day window once at mount (`useMemo(..., [])` in
  `(tabs)/index.tsx`), so an app left open across midnight UTC never asks for the new day and the
  trend line looks stuck until a restart. Fixed in this phase: the window is derived from the current
  date on each render, and Home's pull-to-refresh refetches the history too.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Detect recurring outflows **and** inflows; Home "Upcoming" card; Recurring screen; "Not recurring"; price-change flag | Chosen. Calendar, payday forecast, trial alerts, notifications deferred |
| Source | **Our own detector**, pure TS in `_shared/recurring.ts` | Plaid Recurring is a *separate per-Item monthly fee* (Plaid billing docs) and wants ≥180 days; ours is free, runs on stored history, and is Deno-testable |
| Granularity | One stream per (account, direction, merchant) | Runs inside the per-Item sync claim, so no two invocations ever write the same stream |
| Cadence | End of every successful `syncItem` | No scheduler exists; "upcoming" is date math at read time, so it stays right between syncs |
| Placement | Home card (bills due in 14 days) + pushed `/recurring` screen | Chosen; tab bar stays at five |

## Detector — `supabase/functions/_shared/recurring.ts`

`detectStreams(rows, { transferCategoryIds })` is pure: posted transactions in, stream rows out.

1. **Exclude** transfer-kind categories — by *our* `category_id`, so a manual recategorization counts —
   and zero amounts. The caller passes posted rows only (`pending = false`).
2. **Group** by `(account_id, direction, merchant_key)`; direction from the sign (negative = outflow,
   as in `transactions.amount`). `merchant_key` = `merchant_name ?? name`, lowercased, digits and
   punctuation stripped, whitespace collapsed ("NETFLIX.COM 1234" ≡ "Netflix.com 5678"). Same-day
   charges in a group are summed into one occurrence.
3. **Run:** the newest interval picks the cadence (fits no window → no stream); walk back from the
   newest occurrence while each interval fits it. Then drop occurrences from the *oldest* end while
   one falls outside tolerance of the remaining run's median (a prorated first charge). Qualify only
   with **≥ 3 occurrences**, every amount within tolerance of the run's median:

   | Cadence | Interval (days) | Amount tolerance | Next date |
   | --- | --- | --- | --- |
   | weekly | 5–9 | ±20% | last + 7 |
   | biweekly | 11–17 | ±20% | last + 14 |
   | monthly | 25–35 | ±35% | anchor day (median day-of-month of the run) in the first month on/after `last + 20 days`, clamped to month end |

   The `+20 days` rule survives weekend shifts across a month boundary (a Sep-1 bill paid Aug 30
   predicts Oct 1, not Sep 1). Tight weekly tolerance is what rejects grocery runs.
4. **Output:** `name` and `category_id` from the newest occurrence; `average_amount`, `last_amount`,
   `previous_amount` (ledger sign); `first_date`/`last_date`/`occurrences` of the run; `next_date`;
   `amount_change = |last| − |previous|`, set **only** when every earlier amount in the run is equal to
   the cent and the move is ≥ max($1, 5%) — so variable utilities never flag. Constants are named and
   pinned by tests.

**Wrapper** `refreshRecurring(admin, item, transferCategoryIds)` in the same file: page the Item's
posted transactions from the last 180 days with `.range()` ordered by `(date, id)` — `max_rows = 1000`
truncates silently — run the detector, upsert on `account_id,direction,merchant_key`, then delete this
Item's streams that no longer qualify **unless dismissed**. The payload never includes `dismissed`
(PostgREST's `DO UPDATE SET` uses only present keys — the `accounts.hidden` rule in `accounts.ts`) and
always emits every other key, `amount_change: null` included (ragged keys are PGRST102).

**In `syncItem`:** after the snapshot block, in its own try/catch that logs and never rethrows — same
reasoning as the snapshot: after the cursor and after `result` is latched, never in `finally`.
`loadSyncContext` also loads transfer-kind category ids. Not run on `login_required` (no new data).

## Storage — `supabase/migrations/<ts>_phase5_recurring_streams.sql`

`recurring_streams`: `id uuid pk`, `user_id`, `account_id` (→ accounts, cascade), `merchant_key`,
`direction` check (`outflow`,`inflow`), `name`, `category_id` (→ categories), `frequency` check
(`weekly`,`biweekly`,`monthly`), `average_amount`/`last_amount`/`previous_amount numeric(14,2) not
null`, `amount_change numeric(14,2)` null, `first_date`/`last_date`/`next_date date not null`,
`occurrences int check (>= 3)`, **`dismissed boolean not null default false`** (the user's verdict —
detection never writes it), timestamps + `set_updated_at` trigger, `unique (account_id, direction,
merchant_key)`, index `(user_id, next_date)`.

RLS on; select-own and update-own policies with `(select auth.uid()) = user_id`; `grant select` and
**`grant update (dismissed)`** to `authenticated`, following the column-grant pattern of
`transactions`. No view, so no `security_invoker` concern.

## Client

- `lib/queries.ts`: `RecurringStream` type; `useRecurringStreams()` keyed `['recurring']`, embedding
  `accounts!inner(hidden)` with `.eq('accounts.hidden', false)` exactly like `useTransactions`, ordered
  by `next_date`; `useSetStreamDismissed()` updating only `dismissed`.
- `lib/plaid.ts`: invalidate `['recurring']` next to `['net_worth']` in `useSyncTransactions` and
  `useConnectBank`. The future hide/unhide toggle must invalidate it too (open-item list).
- `lib/recurring.ts` (pure): `todayLocal()` using local getters and the `T00:00:00` parse idiom from
  `lib/month.ts` — not `toISOString()`, which is UTC; `isActive` = `today ≤ next_date + 7|14|31`;
  `upcoming(streams, today, 14)`; `monthlyEquivalent` (×52/12, ×26/12, ×1).
- `components/upcoming-card.tsx` on Home under the hero: active, non-dismissed outflows with
  `today ≤ next_date ≤ today + 14`; up to 5 rows plus "N more"; total due; "See all ›". "Nothing due
  in the next two weeks" when streams exist but none fall in the window; hidden when the user has no
  streams at all. Home's pull-to-refresh also refetches it, and the net worth history (see the close-out above).
- `app/recurring.tsx`, registered as `<Stack.Screen name="recurring" options={{ headerShown: true,
  title: 'Recurring' }} />` inside the session-protected group in `app/_layout.tsx`: header "≈ $X /
  month in bills"; sections Bills & subscriptions, Income, Not recurring (with Restore). Overdue rows
  read "Expected Sep 20", dimmed.
- `components/recurring-row.tsx`: `CategoryIcon`, name, "Monthly · Oct 1", `Amount` of
  `last_amount`, and "↑ $2.50" / "↓ $2.00" when `amount_change` is set. Tap → `Alert` with "Not
  recurring" or "Restore".
- Money via `Amount`, text via `AppText`, colors and spacing from `constants/theme.ts`.

## Known and accepted

- A monthly bill whose third charge falls just outside the 90-day link window is not detected until
  its next charge. Raising `days_requested` at link is a monetization decision (free tier = 90 days).
- No annual, quarterly or semi-monthly cadence; semi-monthly paychecks classify as biweekly, ±3 days.
- A price jump beyond tolerance breaks the run until 3 new charges; a subscription that moves cards is
  one ended stream plus one new one.
- A dismissed stream that stops qualifying is kept forever, so the dismissal survives a re-detection.
- No tier gating: monetization.md lists the radar as a paid feature, so gate it server-side when tiers
  exist.

## Test data

The test user now has two Items: Chase (OAuth — test Link for it on a phone, never the emulator) and
First Platypus Bank with `user_transactions_dynamic` (non-OAuth, realistic recurring data — Netflix,
Spotify, interest charges, loan payments). Use the Platypus Item for recurring checks and for any
`Break (dev)` test on the emulator.
