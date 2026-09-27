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

/**
 * The months a median may be taken over: the window from the herd's first month
 * of data onward. A month before that is absent, not zero — counting it would
 * give a one-month-old herd a median of 0 for everything and offer it nothing.
 * A quiet month after that start is a real zero and still counts.
 */
function activeMonths(rows: MonthlyTotal[], months: string[]): string[] {
  let first: string | null = null;
  for (const r of rows) if (first === null || r.month < first) first = r.month;
  return first === null ? [] : months.filter((m) => m >= first);
}

/** Which line a category's spend belongs to: itself, or its group. Null = not budgetable. */
function lineFor(categoryId: string, byId: CategoriesById): string | null {
  const groupId = groupIdOf(categoryId, byId);
  const group = byId.get(groupId);
  if (!group || group.kind !== 'expense' || SKIP_SLUGS.has(group.slug ?? '')) return null;
  // A group the user hid never comes back as a budget: the hand-built path does
  // not offer one either (withoutHidden on Budgets). A hidden CHILD still rolls
  // up into its visible group — hiding changes the picker, not the arithmetic.
  if (group.hidden) return null;
  // The split group budgets its categories, so a row sitting on the group
  // itself belongs to no bucket and is left out rather than guessed at.
  if (group.slug === SPLIT_GROUP_SLUG) {
    if (categoryId === groupId) return null;
    return byId.get(categoryId)?.hidden ? null : categoryId;
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

  const active = activeMonths(rows, months);
  const out = new Map<string, number>();
  for (const [line, spendByMonth] of perMonth) {
    const value = median(active.map((m) => spendByMonth.get(m) ?? 0));
    // A refund-heavy line is not a negative budget.
    if (value > 0) out.set(line, value);
  }
  return out;
}

/**
 * The herd's typical monthly income: the median of the months' income-kind
 * totals, in whole dollars. Rounding is what makes "is there an estimate?" one
 * question rather than two: an income of a few cents — sandbox data, a stray
 * refund — rounds to 0 and is treated as none, so the field and the caption
 * above it can never disagree.
 */
export function estimateIncome(rows: MonthlyTotal[], months: string[], byId: CategoriesById): number {
  const perMonth = new Map<string, number>();
  for (const r of rows) {
    if (!r.category_id) continue;
    if (byId.get(groupIdOf(r.category_id, byId))?.kind !== 'income') continue;
    perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + r.total);
  }
  const value = Math.round(median(activeMonths(rows, months).map((m) => perMonth.get(m) ?? 0)));
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
