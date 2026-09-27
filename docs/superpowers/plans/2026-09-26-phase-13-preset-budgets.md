# Phase 13: preset budgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a whole budget in one tap from the herd's own income and spending — Match my spending, 50/30/20 or 70/20/10 — previewed before it is applied and editable afterwards.

**Architecture:** All arithmetic is pure and lives in one new module, `lib/presets.ts`, fed by rows the app already fetches (`useMonthlyTotals` over the last 3 full months, `useCategories`). A new sheet shows an editable income estimate, the three presets and a line-by-line preview. Applying calls one `security invoker` SQL function, `replace_budgets`, which swaps the herd's budget rows in a single transaction. The output is ordinary `budgets` rows, so every existing screen keeps working untouched.

**Tech Stack:** Expo SDK 57 / React Native (expo-router, TanStack Query), Supabase Postgres (one migration, one SQL function), app tests with `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md`

## Global Constraints

- History window: the last **3 full** calendar months, ending with the month **before** the current one.
- Typical spend per line: the **median** of those monthly figures. A month with no spend counts as 0. A negative median becomes 0.
- Income: the same median over income-kind categories, summed per month.
- Needs: `bills_and_utilities`, `home`, `medical`, `transportation`, `loan_payments`, `bank_fees`, `services`, `government_and_nonprofit`. Wants: `entertainment`, `shopping`, `travel`, `personal_care`.
- `food_and_dining` is never budgeted as a group: `groceries` is a need, `restaurants_and_bars`, `fast_food` and `coffee_shops` are wants, each budgeted as its own category.
- `uncategorized` is never budgeted, and neither is a line whose typical spend is 0.
- 50/30/20: needs capped at 50% of income, wants at 30%. 70/20/10: needs+wants **minus** `loan_payments` capped at 70%, `loan_payments` alone at 10%.
- Within a bucket: at or under its cap, every line keeps its typical spend; over, every line is scaled by `cap / typical`.
- Every amount rounds to the nearest $5, after scaling. Rounding may exceed a cap; that is accepted.
- Savings = `income − total budgeted`. It is never a budget row, and it may be negative.
- With no full month of history the sheet offers nothing. Without an income figure the two percentage presets are disabled; Match my spending always works.
- App pure logic is tested with `npm test` (`node --test src/lib/*.test.ts`). A test file starts with `/// <reference types="node" />`, and a module under test imports others only as `import type` or by relative `./x.ts` path — never `@/`, never React Native.
- Run `npm run typecheck && npx expo lint` in `apps/mobile` before every app commit.
- Money renders through `components/ui/amount.tsx`, text through `AppText`, colours and spacing only from `constants/theme.ts`.
- Branch `pedro-13` (already created from origin/master, upstream unset). Never commit to master.

## Review Focus

1. **A herd whose income is 0 or missing** must not divide by zero or produce `Infinity`/`NaN` amounts (Task 1 test).
2. **A group whose every month is 0** must produce no budget line at all, rather than a `$0` budget (Task 1 test).
3. **A partial current month** must never enter the window: running on the 1st of a month must still read the 3 months before it (Task 1 test).
4. **A category id from another herd, or an unknown one**, passed to `replace_budgets` must fail the whole call and leave the herd's budgets untouched (Task 2 test, in `rls-check`).
5. **Applying twice in a row** must leave one set of budgets, not duplicates: the delete-then-insert is one transaction keyed on the herd (Task 2 test).

---

## File structure

| File | Responsibility |
|---|---|
| `apps/mobile/src/lib/presets.ts` (new) | All arithmetic: the window, medians, buckets, caps, rounding. Pure. |
| `apps/mobile/src/lib/presets.test.ts` (new) | Its tests. |
| `supabase/migrations/20261003120000_phase13_replace_budgets.sql` (new) | The `replace_budgets` function and its grant. |
| `apps/mobile/src/lib/queries.ts` | `useReplaceBudgets`. |
| `apps/mobile/src/components/preset-sheet.tsx` (new) | The income field, the three presets, the preview, Apply. |
| `apps/mobile/src/app/(tabs)/budgets.tsx` | The two entry points, and the confirm before replacing. |
| `scripts/rls-check.mjs` | Proves `replace_budgets` is herd-scoped. |

---

### Task 1: `presets.ts` — the arithmetic

**Files:**
- Create: `apps/mobile/src/lib/presets.ts`
- Create: `apps/mobile/src/lib/presets.test.ts`

**Interfaces:**
- Consumes: `MonthlyTotal` (`lib/queries.ts`, as `import type`), `CategoriesById` and `groupIdOf` (`lib/categories.ts`), `monthsEndingAt` and `addMonths` (`lib/month.ts`), `spentFor` (`lib/reports.ts`).
- Produces:
  - `type PresetId = 'match' | '50_30_20' | '70_20_10'`
  - `type PresetLine = { categoryId: string; amount: number }`
  - `type Preset = { id: PresetId; name: string; blurb: string; lines: PresetLine[]; total: number; savings: number | null; needsIncome: boolean }`
  - `const HISTORY_MONTHS = 3`
  - `historyWindow(today: Date): { from: string; to: string }`
  - `typicalByLine(rows: MonthlyTotal[], months: string[], byId: CategoriesById): Map<string, number>`
  - `estimateIncome(rows: MonthlyTotal[], months: string[], byId: CategoriesById): number`
  - `buildPresets(typical: Map<string, number>, income: number | null, byId: CategoriesById): Preset[]`

- [ ] **Step 1: Write the failing test** (`presets.test.ts`)

```ts
/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CategoriesById } from './categories.ts';
import { buildPresets, estimateIncome, historyWindow, typicalByLine } from './presets.ts';

// A tiny taxonomy: the slugs the buckets name, plus one custom child and one unmapped group.
const CATS: [string, { id: string; parent_id: string | null; slug: string | null; kind: 'expense' | 'income' | 'transfer'; name: string }][] = [
  ['g-bills', { id: 'g-bills', parent_id: null, slug: 'bills_and_utilities', kind: 'expense', name: 'Bills & Utilities' }],
  ['g-transport', { id: 'g-transport', parent_id: null, slug: 'transportation', kind: 'expense', name: 'Transportation' }],
  ['g-shopping', { id: 'g-shopping', parent_id: null, slug: 'shopping', kind: 'expense', name: 'Shopping' }],
  ['g-loans', { id: 'g-loans', parent_id: null, slug: 'loan_payments', kind: 'expense', name: 'Loan Payments' }],
  ['g-food', { id: 'g-food', parent_id: null, slug: 'food_and_dining', kind: 'expense', name: 'Food & Dining' }],
  ['c-groceries', { id: 'c-groceries', parent_id: 'g-food', slug: 'groceries', kind: 'expense', name: 'Groceries' }],
  ['c-restaurants', { id: 'c-restaurants', parent_id: 'g-food', slug: 'restaurants_and_bars', kind: 'expense', name: 'Restaurants & Bars' }],
  ['c-gas', { id: 'c-gas', parent_id: 'g-transport', slug: 'gas', kind: 'expense', name: 'Gas' }],
  ['c-mine', { id: 'c-mine', parent_id: 'g-shopping', slug: null, kind: 'expense', name: 'My custom one' }],
  ['g-uncat', { id: 'g-uncat', parent_id: null, slug: 'uncategorized', kind: 'expense', name: 'Uncategorized' }],
  ['g-income', { id: 'g-income', parent_id: null, slug: 'income', kind: 'income', name: 'Income' }],
];
const byId = new Map(CATS) as unknown as CategoriesById;

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01'];
/** A view row. `total` keeps the ledger sign, so an expense is negative. */
const row = (month: string, category_id: string, total: number) =>
  ({ month, category_id, iso_currency_code: 'USD', total, transaction_count: 1 });

test('historyWindow takes the 3 full months before the current one', () => {
  assert.deepEqual(historyWindow(new Date(2026, 8, 26)), { from: '2026-06-01', to: '2026-08-01' });
  // The 1st of a month is still inside that month: the window must not include it.
  assert.deepEqual(historyWindow(new Date(2026, 8, 1)), { from: '2026-06-01', to: '2026-08-01' });
  // January reaches back across the year boundary.
  assert.deepEqual(historyWindow(new Date(2026, 0, 15)), { from: '2025-10-01', to: '2025-12-01' });
});

test('typicalByLine takes the median per line, and rolls children into their group', () => {
  const rows = [
    row('2026-06-01', 'g-bills', -100), row('2026-07-01', 'g-bills', -900), row('2026-08-01', 'g-bills', -110),
    // Transportation is only ever spent through its child.
    row('2026-06-01', 'c-gas', -50), row('2026-07-01', 'c-gas', -70), row('2026-08-01', 'c-gas', -60),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  // The 900 month is an outlier: the median ignores it.
  assert.equal(typical.get('g-bills'), 110);
  assert.equal(typical.get('g-transport'), 60);
});

test('typicalByLine counts a month with no spend as zero', () => {
  // Spent in one month of three: the median is 0, so it is not budgetable.
  const typical = typicalByLine([row('2026-07-01', 'g-shopping', -300)], MONTHS, byId);
  assert.equal(typical.get('g-shopping') ?? 0, 0);
});

test('typicalByLine floors a refund-heavy line at zero, and skips uncategorized', () => {
  const rows = [
    row('2026-06-01', 'g-shopping', 40), row('2026-07-01', 'g-shopping', 30), row('2026-08-01', 'g-shopping', 20),
    row('2026-06-01', 'g-uncat', -80), row('2026-07-01', 'g-uncat', -80), row('2026-08-01', 'g-uncat', -80),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  assert.equal(typical.get('g-shopping'), 0);
  assert.equal(typical.has('g-uncat'), false);
});

test('typicalByLine splits Food & Dining into its categories, never the group', () => {
  const rows = [
    row('2026-06-01', 'c-groceries', -400), row('2026-07-01', 'c-groceries', -400), row('2026-08-01', 'c-groceries', -400),
    row('2026-06-01', 'c-restaurants', -100), row('2026-07-01', 'c-restaurants', -100), row('2026-08-01', 'c-restaurants', -100),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  assert.equal(typical.has('g-food'), false);
  assert.equal(typical.get('c-groceries'), 400);
  assert.equal(typical.get('c-restaurants'), 100);
});

test('estimateIncome is the median of the months, so one bonus does not inflate it', () => {
  const rows = [
    row('2026-06-01', 'g-income', 5000), row('2026-07-01', 'g-income', 9000), row('2026-08-01', 'g-income', 5200),
    row('2026-06-01', 'g-bills', -100),
  ];
  assert.equal(estimateIncome(rows, MONTHS, byId), 5200);
});

test('estimateIncome is zero without income rows', () => {
  assert.equal(estimateIncome([row('2026-06-01', 'g-bills', -100)], MONTHS, byId), 0);
});

const typical = new Map([
  ['g-bills', 1000],   // need
  ['c-groceries', 500], // need
  ['g-loans', 400],    // need, and its own bucket in 70/20/10
  ['g-shopping', 300], // want
  ['c-restaurants', 200], // want
]);
const preset = (id: string, income: number | null) => {
  const found = buildPresets(typical, income, byId).find((p) => p.id === id);
  assert.ok(found, `no preset ${id}`);
  return found;
};
const amountOf = (p: { lines: { categoryId: string; amount: number }[] }, id: string) =>
  p.lines.find((l) => l.categoryId === id)?.amount;

test('Match my spending budgets every line at its typical spend', () => {
  const p = preset('match', null);
  assert.equal(amountOf(p, 'g-bills'), 1000);
  assert.equal(amountOf(p, 'c-restaurants'), 200);
  assert.equal(p.total, 2400);
  // No income: nothing to subtract from.
  assert.equal(p.savings, null);
  assert.equal(p.needsIncome, false);
});

test('50/30/20 keeps typical spend when a bucket is under its cap', () => {
  // Needs 1900 vs a 5000 cap, wants 500 vs 3000: both fit, so nothing is scaled.
  const p = preset('50_30_20', 10000);
  assert.equal(amountOf(p, 'g-bills'), 1000);
  assert.equal(amountOf(p, 'g-shopping'), 300);
  assert.equal(p.total, 2400);
  assert.equal(p.savings, 7600);
});

test('50/30/20 scales a bucket down in proportion when it is over its cap', () => {
  // Income 2000: needs cap 1000 against 1900 typical (ratio 1000/1900), wants cap 600 against 500 (fits).
  const p = preset('50_30_20', 2000);
  assert.equal(amountOf(p, 'g-bills'), 525); // 1000 * 1000/1900 = 526.3 -> 525
  assert.equal(amountOf(p, 'c-groceries'), 265); // 500 * 1000/1900 = 263.2 -> 265
  assert.equal(amountOf(p, 'g-loans'), 210); // 400 * 1000/1900 = 210.5 -> 210
  assert.equal(amountOf(p, 'g-shopping'), 300); // wants untouched
});

test('70/20/10 caps loan payments apart from everyday spending', () => {
  // Income 2000: everyday cap 1400 against 2000 typical (bills+groceries+shopping+restaurants),
  // loans cap 200 against 400 typical.
  const p = preset('70_20_10', 2000);
  assert.equal(amountOf(p, 'g-bills'), 700); // 1000 * 1400/2000
  assert.equal(amountOf(p, 'g-loans'), 200); // 400 * 200/400
});

test('every amount is rounded to the nearest five', () => {
  for (const line of preset('50_30_20', 2000).lines) assert.equal(line.amount % 5, 0);
});

test('a preset never budgets a line with no typical spend', () => {
  const p = preset('match', null);
  assert.equal(p.lines.some((l) => l.amount === 0), false);
  assert.equal(p.lines.length, 5);
});

test('without income the percentage presets are flagged and empty, match still works', () => {
  for (const income of [null, 0]) {
    const p = preset('50_30_20', income);
    assert.equal(p.needsIncome, true);
    assert.deepEqual(p.lines, []);
    assert.equal(p.total, 0);
    // No division by zero anywhere.
    assert.equal(Number.isFinite(p.total), true);
    assert.equal(preset('match', income).lines.length, 5);
  }
});

test('buildPresets returns the three presets, in order', () => {
  assert.deepEqual(buildPresets(typical, 5000, byId).map((p) => p.id), ['match', '50_30_20', '70_20_10']);
});

test('with nothing spent, every preset is empty', () => {
  for (const p of buildPresets(new Map(), 5000, byId)) assert.deepEqual(p.lines, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/mobile`): `npm test`
Expected: FAIL — `Cannot find module '.../src/lib/presets.ts'`.

- [ ] **Step 3: Write the implementation** (`presets.ts`)

```ts
/**
 * Preset budgets (Phase 13). Pure: the caller fetches the rows.
 *
 * A whole budget proposed from the herd's own history — what it typically
 * spends per line, capped by a share of what it earns. The result is ordinary
 * budget rows the user edits afterwards, not a new kind of budget.
 */
import type { MonthlyTotal } from '@/lib/queries';

import { type CategoriesById, groupIdOf } from './categories.ts';
import { addMonths, monthStart, monthsEndingAt } from './month.ts';

/** How many full months the medians are taken over. */
export const HISTORY_MONTHS = 3;
/** Every proposed amount lands on a multiple of this. */
const ROUND_TO = 5;

/** Built-in groups that are needs. Everything else expense-kind is a want. */
const NEED_SLUGS = new Set([
  'bills_and_utilities', 'home', 'medical', 'transportation',
  'loan_payments', 'bank_fees', 'services', 'government_and_nonprofit',
]);
/**
 * Food & Dining is the one group split across buckets, so it is budgeted as
 * these categories instead of as the group. Their parent must never also be
 * budgeted — that is the rule budgetsReplacedBy enforces on save.
 */
const SPLIT_GROUP_SLUG = 'food_and_dining';
const SPLIT_NEED_SLUGS = new Set(['groceries']);
/** Never budgeted: there is nothing to plan for what we could not categorize. */
const SKIP_SLUGS = new Set(['uncategorized']);

export type PresetId = 'match' | '50_30_20' | '70_20_10';
export type PresetLine = { categoryId: string; amount: number };
export type Preset = {
  id: PresetId;
  name: string;
  blurb: string;
  lines: PresetLine[];
  total: number;
  /** income − total, or null when there is no income to subtract from. */
  savings: number | null;
  /** True when this preset needs an income figure it did not get. */
  needsIncome: boolean;
};

/** The 3 full months before the one `today` falls in. */
export function historyWindow(today: Date): { from: string; to: string } {
  const lastFull = addMonths(monthStart(today), -1);
  const months = monthsEndingAt(lastFull, HISTORY_MONTHS);
  return { from: months[0], to: months[months.length - 1] };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Which line a category's spend belongs to: itself, or its group. Null = not budgetable. */
function lineFor(categoryId: string, byId: CategoriesById): string | null {
  const groupId = groupIdOf(categoryId, byId);
  const group = byId.get(groupId);
  if (!group || group.kind !== 'expense' || SKIP_SLUGS.has(group.slug ?? '')) return null;
  // The split group budgets its categories, so a row sitting on the group
  // itself belongs to no bucket and is left out rather than guessed at.
  if (group.slug === SPLIT_GROUP_SLUG) {
    return categoryId === groupId ? null : categoryId;
  }
  return groupId;
}

/** The typical monthly spend of every budgetable line: the median over `months`. */
export function typicalByLine(
  rows: MonthlyTotal[],
  months: string[],
  byId: CategoriesById,
): Map<string, number> {
  // line -> month -> spend. A month with no row is a real zero, not missing data.
  const perMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.category_id) continue;
    const line = lineFor(r.category_id, byId);
    if (line === null) continue;
    const spendByMonth = perMonth.get(line) ?? new Map<string, number>();
    // spentFor's sign flip, inline: this module must not import a React Native path.
    spendByMonth.set(r.month, (spendByMonth.get(r.month) ?? 0) + -r.total);
    perMonth.set(line, spendByMonth);
  }

  const out = new Map<string, number>();
  for (const [line, spendByMonth] of perMonth) {
    const value = median(months.map((m) => spendByMonth.get(m) ?? 0));
    // A refund-heavy line is not a negative budget.
    if (value > 0) out.set(line, value);
  }
  return out;
}

/** The herd's typical monthly income: the median of the months' income-kind totals. */
export function estimateIncome(rows: MonthlyTotal[], months: string[], byId: CategoriesById): number {
  const perMonth = new Map<string, number>();
  for (const r of rows) {
    if (!r.category_id) continue;
    if (byId.get(groupIdOf(r.category_id, byId))?.kind !== 'income') continue;
    perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + r.total);
  }
  const value = median(months.map((m) => perMonth.get(m) ?? 0));
  return value > 0 ? value : 0;
}

const isNeed = (lineId: string, byId: CategoriesById): boolean => {
  const category = byId.get(lineId);
  const group = byId.get(groupIdOf(lineId, byId));
  if (group?.slug === SPLIT_GROUP_SLUG) return SPLIT_NEED_SLUGS.has(category?.slug ?? '');
  return NEED_SLUGS.has(group?.slug ?? '');
};

const isLoan = (lineId: string, byId: CategoriesById): boolean =>
  byId.get(groupIdOf(lineId, byId))?.slug === 'loan_payments';

const round = (amount: number): number => Math.round(amount / ROUND_TO) * ROUND_TO;

/**
 * One bucket's lines, capped. Under the cap every line keeps its typical spend:
 * a preset never budgets more than the herd actually spends, and the slack shows
 * up as savings. Over it, the lines scale in proportion.
 */
function capped(ids: string[], typical: Map<string, number>, cap: number): PresetLine[] {
  const sum = ids.reduce((n, id) => n + (typical.get(id) ?? 0), 0);
  // cap > 0 is guaranteed by the caller (income > 0), so the ratio is finite.
  const ratio = sum > cap ? cap / sum : 1;
  return ids
    .map((id) => ({ categoryId: id, amount: round((typical.get(id) ?? 0) * ratio) }))
    .filter((l) => l.amount > 0);
}

const finish = (
  id: PresetId,
  name: string,
  blurb: string,
  lines: PresetLine[],
  income: number | null,
): Preset => {
  const total = lines.reduce((n, l) => n + l.amount, 0);
  return { id, name, blurb, lines, total, savings: income ? income - total : null, needsIncome: false };
};

/**
 * The three presets, always all three and always in this order: an unusable one
 * comes back flagged rather than missing, so the sheet can explain why.
 */
export function buildPresets(
  typical: Map<string, number>,
  income: number | null,
  byId: CategoriesById,
): Preset[] {
  const ids = [...typical.keys()];
  const needs = ids.filter((id) => isNeed(id, byId));
  const wants = ids.filter((id) => !isNeed(id, byId));
  const loans = ids.filter((id) => isLoan(id, byId));
  const everyday = ids.filter((id) => !isLoan(id, byId));

  const match = finish(
    'match',
    'Match my spending',
    'Every category gets what you typically spend.',
    ids.map((id) => ({ categoryId: id, amount: round(typical.get(id) ?? 0) })).filter((l) => l.amount > 0),
    income,
  );

  if (!income || income <= 0) {
    const empty = (id: PresetId, name: string, blurb: string): Preset =>
      ({ id, name, blurb, lines: [], total: 0, savings: null, needsIncome: true });
    return [
      match,
      empty('50_30_20', '50/30/20', 'Half needs, a third wants, the rest saved.'),
      empty('70_20_10', '70/20/10', 'Living costs, savings, then debt.'),
    ];
  }

  return [
    match,
    finish('50_30_20', '50/30/20', 'Half needs, a third wants, the rest saved.', [
      ...capped(needs, typical, income * 0.5),
      ...capped(wants, typical, income * 0.3),
    ], income),
    finish('70_20_10', '70/20/10', 'Living costs, savings, then debt.', [
      ...capped(everyday, typical, income * 0.7),
      ...capped(loans, typical, income * 0.1),
    ], income),
  ];
}
```

- [ ] **Step 4: Run the tests**

Run (in `apps/mobile`): `npm test`
Expected: PASS, every test in `presets.test.ts` included.

- [ ] **Step 5: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/presets.ts apps/mobile/src/lib/presets.test.ts
git commit -m "feat(budgets): build a budget from the herd's own income and spending (Phase 13)"
```
(End every commit message with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` line.)

---

### Task 2: `replace_budgets` — swap the herd's budgets in one transaction

**Files:**
- Create: `supabase/migrations/20261003120000_phase13_replace_budgets.sql`
- Modify: `scripts/rls-check.mjs` (declarations, write probes, `WRITE_EXPECT`)

**Interfaces:**
- Produces: `public.replace_budgets(p_lines jsonb) returns int` — deletes every budget row of the caller's herd, inserts one row per `{ category_id, amount }` in the array, and returns how many it inserted. `security invoker`, granted to `authenticated`.

- [ ] **Step 1: Add the failing RLS probes.** In `scripts/rls-check.mjs`, inside `block()`:

Add to the `declare` list (after `other_cat uuid;`):
```sql
  my_cat uuid;
```

Add after the `-- Phase 12a: a row Tusky categorized...` select block:
```sql
  -- Phase 13: a built-in category this user may budget.
  select id into my_cat from public.categories where herd_id is null and parent_id is null and kind = 'expense' limit 1;
```

Add before the `-- Only the owner renames the herd.` line:
```sql
  -- Phase 13: replace_budgets writes only the caller's herd, atomically.
  if my_cat is not null then
    perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', my_cat, 'amount', 123)));
    w := w || jsonb_build_object('replace_budgets_scoped',
      (select count(*) = 1 from public.budgets where herd_id = h)
      and (select count(*) from public.budgets where herd_id <> h) = 0);
    -- Applying twice leaves one set, not two.
    perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', my_cat, 'amount', 321)));
    w := w || jsonb_build_object('replace_budgets_idempotent',
      (select count(*) = 1 and max(amount) = 321 from public.budgets where herd_id = h));
    -- An unknown category fails the whole call and leaves the herd's budgets alone.
    begin
      perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', gen_random_uuid(), 'amount', 9)));
      w := w || jsonb_build_object('replace_budgets_unknown_category', 'allowed');
    exception when others then
      w := w || jsonb_build_object('replace_budgets_unknown_category', 'denied');
    end;
    w := w || jsonb_build_object('replace_budgets_intact_after_failure',
      (select count(*) = 1 and max(amount) = 321 from public.budgets where herd_id = h));
  end if;
  -- Phase 13: the calls above must not have touched any other herd's budgets.
  -- RLS hides them, so a leak shows up as rows this user can suddenly see.
  w := w || jsonb_build_object('replace_budgets_other_herds_untouched',
    (select count(*) from public.budgets where herd_id <> h) = 0);
```

Add to `WRITE_EXPECT`:
```js
  replace_budgets_scoped: true,
  replace_budgets_idempotent: true,
  replace_budgets_unknown_category: 'denied',
  replace_budgets_intact_after_failure: true,
  replace_budgets_other_herds_untouched: true,
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/rls-check.mjs ccbd42ef-cba6-4f05-a100-a83a727255b2`
Expected: `FAIL ... no result`, with `function public.replace_budgets(jsonb) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- Phase 13: apply a preset budget in one transaction. The app builds the lines
-- (lib/presets.ts) and sends them here rather than deleting and inserting one
-- row at a time, so a dropped connection can never leave half a budget.
--
-- security invoker: the herd policies on budgets, and its
-- herd_id default private.my_herd_id(), apply exactly as they do to the
-- client's own writes. The insert selects from the array, so the amount check,
-- the categories foreign key and the policies all still run: an unknown or
-- another herd's category fails the whole call.
-- See docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md.

create function public.replace_budgets(p_lines jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted int;
begin
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  -- RLS decides the rows this touches: it is the caller's herd, never a parameter.
  delete from public.budgets where herd_id = (select private.my_herd_id());

  insert into public.budgets (category_id, amount)
  select (l->>'category_id')::uuid, (l->>'amount')::numeric
  from jsonb_array_elements(p_lines) l;
  get diagnostics inserted = row_count;

  return inserted;
end;
$$;

revoke execute on function public.replace_budgets(jsonb) from public, anon;
grant execute on function public.replace_budgets(jsonb) to authenticated;
```

- [ ] **Step 4: Apply it to dev and verify**

Run: `npx supabase db push` (the CLI is linked to dev; answer `Y`).
Run: `node scripts/rls-check.mjs`
Expected: every line PASS, the five `replace_budgets_*` probes included.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003120000_phase13_replace_budgets.sql scripts/rls-check.mjs
git commit -m "feat(db): replace a herd's budgets in one transaction (Phase 13)"
```

---

### Task 3: `useReplaceBudgets`

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts` (after `useDeleteBudget`, ~line 458)

**Interfaces:**
- Consumes: `replace_budgets` (Task 2); `PresetLine` (Task 1).
- Produces: `useReplaceBudgets()` — a mutation taking `PresetLine[]`.

- [ ] **Step 1: Add the mutation.** In `lib/queries.ts`, add `import type { PresetLine } from '@/lib/presets';` with the other imports, and after `useDeleteBudget`:

```ts
/**
 * Apply a preset (Phase 13): the herd's budgets are replaced by these lines in
 * one transaction, so a dropped connection never leaves half a budget. The
 * function is security invoker, so the same herd policies as every other write
 * apply. Reports refresh too: the bars on Budgets read the totals view.
 */
export function useReplaceBudgets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (lines: PresetLine[]) => {
      const { error } = await supabase.rpc('replace_budgets', {
        p_lines: lines.map((l) => ({ category_id: l.categoryId, amount: l.amount })),
      });
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/queries.ts
git commit -m "feat(app): a mutation that applies a whole preset budget (Phase 13)"
```

---

### Task 4: The preset sheet

**Files:**
- Create: `apps/mobile/src/components/preset-sheet.tsx`

**Interfaces:**
- Consumes: `Preset`, `PresetLine`, `buildPresets`, `estimateIncome`, `historyWindow`, `typicalByLine` (Task 1); `useCategories`, `useMonthlyTotals` (`lib/queries.ts`); `Sheet`, `Amount`, `AppText`, `Button`, `TextField`, `CategoryIcon`.
- Produces: `PresetSheet({ visible, onApply, onClose, isSaving }: { visible: boolean; onApply: (lines: PresetLine[]) => void; onClose: () => void; isSaving?: boolean })`.

- [ ] **Step 1: Write the component**

```tsx
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buildPresets,
  estimateIncome,
  historyWindow,
  type Preset,
  type PresetLine,
} from '@/lib/presets';
import { useCategories, useMonthlyTotals } from '@/lib/queries';
import { monthsEndingAt } from '@/lib/month';
import { typicalByLine, HISTORY_MONTHS } from '@/lib/presets';

type Props = {
  visible: boolean;
  onApply: (lines: PresetLine[]) => void;
  onClose: () => void;
  isSaving?: boolean;
};

/**
 * Build a whole budget from the herd's own history (Phase 13). The income
 * estimate is editable, because a median of three months is a guess: a raise,
 * a gap or a side job all make it wrong, and only the user knows which.
 */
export function PresetSheet({ visible, onApply, onClose, isSaving }: Props) {
  const colors = useTheme();
  const { from, to } = useMemo(() => historyWindow(new Date()), []);
  const { data: categories = [] } = useCategories();
  const { data: totals = [] } = useMonthlyTotals(from, to);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const months = useMemo(() => monthsEndingAt(to, HISTORY_MONTHS), [to]);
  const typical = useMemo(() => typicalByLine(totals, months, byId), [totals, months, byId]);
  const estimate = useMemo(() => estimateIncome(totals, months, byId), [totals, months, byId]);

  // Seeded once per mount; the screen keys this component on `visible`, so each
  // opening starts from a fresh estimate rather than the last typed value.
  const [income, setIncome] = useState(() => (estimate > 0 ? String(Math.round(estimate)) : ''));
  const [chosen, setChosen] = useState<Preset['id'] | null>(null);

  const parsedIncome = Number(income.replace(',', '.'));
  const usableIncome = Number.isFinite(parsedIncome) && parsedIncome > 0 ? parsedIncome : null;
  const presets = useMemo(() => buildPresets(typical, usableIncome, byId), [typical, usableIncome, byId]);
  const selected = presets.find((p) => p.id === chosen) ?? null;
  const nothingToUse = typical.size === 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      style={{ maxHeight: '88%', paddingTop: Spacing.lg, paddingHorizontal: Spacing.md, gap: Spacing.md }}>
      <AppText variant="title">Build my budget</AppText>

      {nothingToUse ? (
        <AppText tone="dim">
          Tusky needs a full month of spending before it can suggest a budget. Come back once this
          month is over, or set a budget by hand below.
        </AppText>
      ) : (
        <ScrollView contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.md }}>
          <View style={{ gap: Spacing.xs }}>
            <TextField
              label="Monthly income"
              value={income}
              onChangeText={setIncome}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <AppText variant="caption" tone="dim">
              {estimate > 0 ? 'Estimated from your last 3 months. Change it if it looks wrong.'
                : 'We could not find income in the last 3 months. Enter it to use a percentage preset.'}
            </AppText>
          </View>

          {presets.map((preset) => {
            const disabled = preset.needsIncome;
            const isChosen = preset.id === chosen;
            return (
              <Pressable
                key={preset.id}
                disabled={disabled}
                onPress={() => setChosen(preset.id)}
                style={{
                  padding: Spacing.md,
                  gap: Spacing.xs,
                  borderRadius: Radius.lg,
                  borderWidth: 1,
                  borderColor: isChosen ? colors.brand : colors.border,
                  backgroundColor: isChosen ? colors.elevated : 'transparent',
                  opacity: disabled ? 0.5 : 1,
                }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="label">{preset.name}</AppText>
                  {disabled ? null : <Amount value={-preset.total} size={16} />}
                </View>
                <AppText variant="caption" tone="dim">
                  {disabled ? 'Enter your income to use this one.'
                    : preset.savings !== null
                      ? `${preset.blurb} Leaves ${preset.savings < 0 ? 'you short by ' : ''}${Math.abs(Math.round(preset.savings))} a month.`
                      : preset.blurb}
                </AppText>
              </Pressable>
            );
          })}

          {selected ? (
            <View style={{ gap: Spacing.xs }}>
              <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.1 }}>
                What you would get
              </AppText>
              {[...selected.lines]
                .sort((a, b) => b.amount - a.amount)
                .map((line) => {
                  const category = byId.get(line.categoryId);
                  return (
                    <View
                      key={line.categoryId}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }}>
                      <CategoryIcon name={category?.icon} size={16} color={category?.color ?? colors.textDim} />
                      <AppText style={{ flex: 1 }}>{category?.name ?? 'Category'}</AppText>
                      <Amount value={-line.amount} size={15} />
                    </View>
                  );
                })}
              {selected.savings !== null ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.xs }}>
                  <AppText variant="label">{selected.savings < 0 ? 'Short by' : 'Left to save'}</AppText>
                  <Amount value={Math.abs(selected.savings)} size={15} />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {nothingToUse ? null : (
        <Button
          title="Apply this budget"
          disabled={!selected || selected.lines.length === 0}
          loading={isSaving}
          onPress={() => selected && onApply(selected.lines)}
        />
      )}
    </Sheet>
  );
}
```

- [ ] **Step 2: Tidy the imports.** Merge the two `@/lib/presets` imports into one:

```tsx
import {
  buildPresets,
  estimateIncome,
  HISTORY_MONTHS,
  historyWindow,
  type Preset,
  type PresetLine,
  typicalByLine,
} from '@/lib/presets';
```
and delete the second import line.

- [ ] **Step 3: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint`
Expected: no errors. (`colors.border` is the hairline border token in `constants/theme.ts`.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/preset-sheet.tsx
git commit -m "feat(budgets): a sheet that previews a preset budget before applying it (Phase 13)"
```

---

### Task 5: The two entry points on Budgets, and the demo

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/budgets.tsx`
- Modify: `CLAUDE.md`, `README.md`, `docs/product/preset-budgets.md`

**Interfaces:**
- Consumes: `PresetSheet` (Task 4), `useReplaceBudgets` (Task 3).

- [ ] **Step 1: Wire the screen.** In `app/(tabs)/budgets.tsx`:

Add the imports:
```tsx
import { PresetSheet } from '@/components/preset-sheet';
```
and add `useReplaceBudgets` to the existing `@/lib/queries` import list.

After `const deleteBudget = useDeleteBudget();` add:
```tsx
  const replaceBudgets = useReplaceBudgets();
  const [presetOpen, setPresetOpen] = useState(false);
```

Before the `return (`, add the apply handler:
```tsx
  // Replacing is the whole point of a preset: a merge would leave a half-preset
  // budget nobody chose. The confirm names what it costs.
  const applyPreset = (lines: PresetLine[]) => {
    const write = () => {
      replaceBudgets.mutate(lines, {
        onError: () => Alert.alert('Could not build the budget', 'Check your connection and try again.'),
      });
      setPresetOpen(false);
    };
    if (budgets.length === 0) {
      write();
      return;
    }
    Alert.alert(
      `Replace your ${budgets.length} budget${budgets.length === 1 ? '' : 's'}?`,
      'The preset writes a fresh set. You can edit any of them afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: write },
      ],
    );
  };
```
and add `import type { PresetLine } from '@/lib/presets';` with the other imports.

Directly after the `<MonthStepper ... />` line, add the empty-state entry point:
```tsx
        {budgets.length === 0 ? (
          <Card style={{ gap: Spacing.sm }}>
            <AppText variant="title">Build my budget</AppText>
            <AppText tone="dim">
              Start from what you already earn and spend, then edit anything.
            </AppText>
            <Button title="Build my budget" onPress={() => setPresetOpen(true)} />
          </Card>
        ) : null}
```

Directly before the `<View style={{ height: Spacing.xxl }} />` spacer, add the other entry point:
```tsx
        {budgets.length > 0 ? (
          <Button title="Rebuild from a preset" variant="ghost" onPress={() => setPresetOpen(true)} />
        ) : null}
```

Next to the existing `<BudgetSheet ... />`, add:
```tsx
      <PresetSheet
        key={presetOpen ? 'open' : 'closed'}
        visible={presetOpen}
        isSaving={replaceBudgets.isPending}
        onApply={applyPreset}
        onClose={() => setPresetOpen(false)}
      />
```

- [ ] **Step 2: Typecheck, lint, test**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: no errors, all tests PASS.

- [ ] **Step 3: Demo on the emulator** (Metro running; JS hot-reloads)
  1. Note the herd's budgets: `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) from budgets"`.
  2. `node scripts/emu.mjs ui`, open the Budgets tab.
  3. With budgets present, tap "Rebuild from a preset". Expected: the sheet opens with an income figure filled in.
  4. Tap 50/30/20. Expected: a preview listing categories, biggest first, and a "Left to save" line.
  5. Tap "Apply this budget", then "Replace" in the confirm. Expected: the sheet closes and the Budgets list shows the new bars.
  6. Check the total matches: `npx -y supabase@2.118.0 db query --linked -o csv "select count(*), sum(amount) from budgets"`.
  7. Run it again with "Match my spending". Expected: the count changes, and nothing is duplicated.
  8. `node scripts/emu.mjs logs`. Expected: no JS errors.

- [ ] **Step 4: Docs**
  - **CLAUDE.md**, a new Conventions bullet after the budgets-related ones:
    ```markdown
    - **Preset budgets** (Phase 13). `lib/presets.ts` is pure: it takes the last 3 full months of
      `monthly_category_totals`, takes a median per line, and caps each bucket by a share of the
      median income. Built-in group slugs decide needs from wants, and `food_and_dining` is budgeted
      as its categories so a group and its children are never budgeted at once. Applying calls
      `replace_budgets(p_lines jsonb)`, a `security invoker` function that swaps the herd's budget
      rows in one transaction. Spec: `docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md`.
    ```
  - **README.md**, Status: add `- ✅ **Phase 13** — preset budgets: a whole budget in one tap from your own income and spending (Match my spending, 50/30/20, 70/20/10) — [spec](docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md)`.
  - **docs/product/preset-budgets.md**: replace the "Rough shape" and "Open questions" sections with a line pointing at the spec, and keep the file as the product note that it is: `Built in Phase 13. See docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md.`

- [ ] **Step 5: Final checks**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Run: `node scripts/rls-check.mjs`
Expected: everything PASS.

- [ ] **Step 6: Commit, then open the PR**

```bash
git add "apps/mobile/src/app/(tabs)/budgets.tsx" CLAUDE.md README.md docs/product/preset-budgets.md docs/superpowers/plans/2026-09-26-phase-13-preset-budgets.md
git commit -m "feat(budgets): build or rebuild a budget from a preset (Phase 13)"
git push -u origin pedro-13
gh pr create --base master --title "Phase 13: preset budgets" --body-file <file>
```
The PR body says what changed, how it was tested, and "After merge: `db push` on production (one migration, no backfill) — no function deploy needed". It ends with the Claude Code attribution line. Do not merge: Pedro merges.
