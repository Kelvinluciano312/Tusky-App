# Preset budgets (planned, unscheduled)

Noted 2026-09-24. Not yet part of any phase.

This is a one-tap starting budget for people who don't have time to build one by hand. Tusky looks at
the user's income and proposes percentage-based limits, so monthly spending stays under what comes in.

## Rough shape

- Estimate monthly income from past income transactions. Use recurring detection for paychecks, and
  something like a median of recent months so a bonus doesn't inflate the number.
- Apply a preset split, for example a 50/30/20 needs/wants/savings rule, mapped onto our category groups.
- Scale each group's limit using the user's actual history. Keep the total at or below income.
- The result is an ordinary budget the user can edit afterwards, not a separate kind of budget.

## Open questions

- Which presets to offer (50/30/20, 70/20/10, "match last 3 months, trimmed")?
- How it handles irregular or no income (freelancers, students)?
- Does it re-suggest when income changes?
- Is it a free-tier feature or paid? If AI tunes it, it uses credits (see `monetization.md`).

## Existing pieces to build on

Budgets and budget suggestions already exist, and hidden categories already stay out of suggestions.
Rollups go through `lib/categories.ts`. A group and its children are never budgeted at once
(`budgetsReplacedBy`), so presets should budget at the group level.
