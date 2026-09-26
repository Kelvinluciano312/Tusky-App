# Phase 11: shared money

These features build on Phase 9d's who paid: spending by person, a who-paid filter on the feed, and splits with settle-up. Each shows only in a herd of two or more (`isShared` in `lib/herd.ts`).

## What we decided with Pedro (2026-09-26)

- All three features are in scope, shipped as two PRs:
  - **11a:** spending by person, and the feed filter.
  - **11b:** splits and settle-up.
- **By default, Joint means equal shares.** A purchase marked Joint is split equally, and any single purchase can be given a custom split instead.
- **The account's owner paid, and the chips say who it was for.**
  - The money comes from the account's owner (`accounts.owner_id`). A Joint account counts as funded equally by everyone.
  - The 9d chips now answer "For: Pedro / Kelvyn / Joint / Split…". The column keeps its name, `transactions.paid_by`, but it now means "whose expense".
  - A debt appears only when "for" differs from the account's owner. The 9d backfill set each row's `paid_by` to its account's owner, so nobody owes anything on day one.

## 11a: spending by person and the payer filter

**The view.** `monthly_person_totals` is `monthly_category_totals` with one more grouping column, `paid_by`. It has the same `security_invoker` flag, herd filter and hidden-account filter, and is a separate view so that budgets and the donut are untouched. `scripts/rls-check.mjs` compares its row count with what each user should see.

**Reports.** A "By person" card follows the selected month (`buildPersonSpending` in `lib/reports.ts`).
- The kind rule is the same as the donut's: income and transfers are left out.
- Every current member is listed, even at $0. Joint and "Former member" appear only when they have spending.
- A month where refunds outweigh purchases shows a negative amount and takes no share of the bar.

**The feed.** A chip row reads Everyone / each member / Joint.
- Filtering happens on the client, like search. While the filter is on, every page is loaded.
- A choice that no longer exists falls back to Everyone: a member who has left, or a herd that is down to one person.

**Freshness.** Setting a payer, or an account's owner, now refreshes the whole `['transactions']` prefix and `['reports']`. Before, only the transaction's detail screen refreshed.

## 11b: splits and settle-up (next PR)

**Splits.** `transactions.split jsonb` holds `{ user_id: percent }`.
- A trigger checks it: at least 2 members, each in the herd, each percent above 0, totalling 100.
- A split sets `paid_by` to null (manual). Choosing a person or Joint clears the split.
- `carryForward` moves a split from a pending transaction onto its posted version.

**Settlements.** A `settlements` table (from, to, amount, date, note), scoped by herd. The app may insert rows and delete them (for Undo).

**Which rows count.** The `shared_lines` view lists the rows that can create a debt:
- posted;
- on an account that is neither private nor hidden;
- expense kind;
- where the owner differs from "for", or a split is set.

Private accounts are left out, so every member computes the same balance from rows they can all see.

**Balances.** `lib/settle.ts` holds the logic:
- `benefitShares` and `fundingShares` work out each person's part of a row. Joint is split equally among the members who had joined by the row's date.
- `balances` nets everything per person, with each recorded settlement moving money back.
- `settleTransfers` finds the fewest payments that square everyone.

**UI.**
- The chips gain a "Paid from X's account · Y owes X $Z" caption and a Split… sheet.
- A `/settle` screen shows the balance and has "Record payment" and an Undo history.
- Home gets a card when the balance isn't zero, and the herd screen gets a "Settle up" row.
- Leaving a herd shows your balance first.

**Known v1 limits.**
- A bank payment (Zelle, Venmo) isn't matched automatically. You record it by hand.
- A member who leaves takes no balance with them.
- Single currency only.
