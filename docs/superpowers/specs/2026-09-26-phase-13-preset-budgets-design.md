# Phase 13: preset budgets

A budget built by hand is the main reason people give up on a finance app before it helps them. Tusky
already knows what a herd earns and what it spends, so it can propose a whole budget in one tap and let
the user edit it afterwards. The result is ordinary budget rows, not a new kind of budget: every screen
that reads `budgets` today keeps working, untouched.

This picks up `docs/product/preset-budgets.md` (noted 2026-09-24) and answers its open questions.

## What we decided with Pedro (2026-09-26)

- **Two entry points.** A prominent "Build my budget" card when the herd has no budgets, and a quieter
  "Rebuild from a preset" action once it has some. Both open the same sheet; rebuilding replaces the
  herd's budgets, after a confirm.
- **Three presets:** Match my spending, 50/30/20 and 70/20/10. No custom split in this phase.
- **Income is estimated and editable.** Tusky proposes the median of the last 3 full months of income
  and shows it in a field the user can change before applying. Match my spending needs no income.
- **One implementation milestone.** Phase 13 is a single PR.

## The numbers

All of it is pure and lives in `apps/mobile/src/lib/presets.ts`, tested with `npm test`. The inputs are
rows the app already has.

**History.** The last 3 **full** calendar months, ending with the month before the current one. The
current month is partial and would drag every number down. `monthsEndingAt` (`lib/month.ts`) produces
the range, and `useMonthlyTotals` fetches it: the same `monthly_category_totals` view Budgets and
Reports read, so hidden accounts and other members' private accounts are already excluded, and the
totals are the whole herd's.

**Typical spend per group.** Roll each month's category totals up to their group (`rollupByGroup`,
`lib/categories.ts`), then take the **median** of the (up to 3) monthly figures per group. A median
ignores the one month with a car repair. A month with no spend in a group counts as 0, so an
every-other-month expense is halved rather than budgeted in full. Negative medians (refunds outweigh
purchases) become 0.

**Income.** The same median over the months' income-kind categories, summed per month. `spentFor`
inverts the ledger sign, so income arrives negative there and is read directly from `total`.

**Buckets.** Each built-in **group** is a need or a want, from one table in `presets.ts` keyed by
slug:

| Needs | Wants |
| --- | --- |
| `bills_and_utilities`, `home`, `medical`, `transportation`, `loan_payments`, `bank_fees`, `services`, `government_and_nonprofit` | `entertainment`, `shopping`, `travel`, `personal_care` |

- **`food_and_dining` is split.** `groceries` is a need; `restaurants_and_bars`, `fast_food` and
  `coffee_shops` are wants. A preset that budgets Food & Dining therefore budgets those four
  **categories**, never the group, which is what keeps `budgetsReplacedBy`'s "never both" rule true.
  Every other group is budgeted as the group.
- **`uncategorized` is never budgeted.** Neither is a group whose typical spend is 0.
- **A custom category** (Phase 7b) is a child of a built-in group and rolls up into it, so it needs no
  entry of its own. A hidden category still rolls up: hiding affects the picker, not the arithmetic.

**Match my spending.** Every budgetable line gets its typical spend. No income needed; nothing is
scaled.

**50/30/20.** Needs are capped at 50% of income, wants at 30%. Within a bucket:

- if the bucket's typical spend is at or under its cap, **each line keeps its typical spend** — a
  preset never budgets more than the herd actually spends, and the slack shows up as savings;
- if it is over, every line in the bucket is scaled by `cap / typical`, proportionally.

**70/20/10.** Two buckets, not three: everyday spending — needs and wants together, **minus**
`loan_payments` — is capped at 70%, and `loan_payments` alone at 10%. The 20% is what remains when both
caps are reached; it is the savings target, not a cap of its own. Same at-or-under and scale-down rule.
A herd with no loan payments simply budgets nothing there, and the 10% joins its savings.

**Savings** is `income − total budgeted`, shown as a line in the preview and never written as a budget
row. It is the actual leftover, so it is larger than the preset's target whenever spending is under a
cap. It can be negative when spending already exceeds income, and the sheet says so plainly rather than
hiding it. Match my spending shows the line only when an income figure is present, since without one
there is nothing to subtract from.

**Rounding.** Each line rounds to the nearest $5, after scaling. Rounding can push a bucket a few
dollars over its cap; that is accepted rather than redistributed, because a budget of $237.43 reads
worse than the cap being $8 off.

**Too little history.** With no full month of history the sheet explains that and offers nothing. With
one or two months it works, on that much data.

**No income.** The two percentage presets need a number. With no income history the field starts empty
and those presets stay disabled until the user types one. Match my spending is always available.

## The sheet

`components/preset-sheet.tsx`, built on the shared `Sheet` (`components/ui/sheet.tsx`) with
`avoidKeyboard`, because it holds a text field.

- **Income** at the top: a currency field, pre-filled with the estimate, with a caption naming where
  the estimate came from ("your last 3 months").
- **Three preset cards**, each with its total and its savings line. Selecting one shows the preview.
- **The preview** lists every line and its amount, biggest first, and the savings line last.
- **Apply** writes the budgets. When the herd already has budgets, an `Alert` first says how many will
  be replaced.
- Applying closes the sheet and the Budgets screen shows the new bars.

**On the Budgets screen** (`app/(tabs)/budgets.tsx`):

- no budgets → a `Card` above the list: "Build my budget · Start from your own spending, then edit
  anything";
- any budget → a text button under the list: "Rebuild from a preset".

## Saving

`replace_budgets(p_lines jsonb)` — a `security invoker` SQL function, so the herd's RLS policies and the
`herd_id default private.my_herd_id()` on `budgets` apply exactly as they do to the client's own writes.
It deletes **every** budget row of the caller's herd and inserts the new ones in one statement pair,
inside the one transaction a function body gets, so a dropped connection can never leave half a budget.
Granted to `authenticated` only.

`p_lines` is a JSON array of `{ category_id, amount }`. The function trusts neither: it inserts by
selecting from the array, so the `budgets` check constraint (`amount >= 0`), its foreign key to
`categories`, and the herd policies all still apply. An unknown or another herd's category id therefore
fails the whole call rather than writing a bad row.

The app calls it through `supabase.rpc`, in a new `useReplaceBudgets` mutation beside the existing
budget mutations in `lib/queries.ts`, and invalidates `['budgets']` and `['reports']` on success — the
same keys `useSetBudget` uses.

## Reused pieces

`rollupByGroup`, `buildTree` and `budgetsReplacedBy` (`lib/categories.ts`); `spentFor` and
`spentByCategory` (`lib/reports.ts`); `monthsEndingAt`, `monthStart` and `addMonths` (`lib/month.ts`);
`useMonthlyTotals`, `useBudgets`, `useCategories` (`lib/queries.ts`); `Sheet`, `Amount`, `AppText`,
`Card`, `Button`.

## Known and accepted

- **A preset overwrites, it never merges.** Rebuilding after hand-tuning loses the tuning. The confirm
  names the count, and Budgets is one screen away.
- **The bucket table covers built-in groups only,** by slug. A future built-in group would default to
  wants until it is added to the table.
- **Rounding can exceed a cap** by a few dollars per line (above).
- **One currency.** Medians sum across currencies, the same assumption net worth and Reports already
  make.
- **Income counts every income-kind category,** including one-offs that recur rarely. The median over
  three months is what dampens them, not a classifier.

## Deferred

- A custom needs/wants/savings split, and sliders.
- "Trim wants by 10%".
- Re-suggesting when income changes, and any notification.
- Per-month budgets and rollover (still deferred from Phase 3).
- AI-tuned presets (they would spend credits; see `docs/product/monetization.md`).

## Verification

- `npm test` in `apps/mobile` — `presets.ts`: the income median (including a bonus month and a missed
  paycheck), typical spend (median, a zero month, a negative month), each preset at/under and over its
  cap, the Food & Dining split, `uncategorized` excluded, $5 rounding, no history, no income.
- `npm run typecheck && npx expo lint`.
- `node scripts/rls-check.mjs` — `replace_budgets` cannot touch another herd's budgets, and leaves the
  caller's own intact on a failed call.
- Emulator demo: with budgets deleted, Build my budget → 50/30/20 → apply → the Budgets screen shows
  bars whose total matches the preview; then Rebuild from a preset → Match my spending → the confirm
  names the replaced count.
