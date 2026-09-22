import type { Category, MonthlyTotal } from '@/lib/queries';

/** Rows from the view carry no category when category_id is null. */
const NO_CATEGORY = '__none';

export type CategoriesById = Map<string, Category>;

/**
 * The one sign flip in the app.
 *
 * `monthly_category_totals.total` keeps the ledger sign that `transactions.amount`
 * uses — money in is positive, so an expense category's total is NEGATIVE.
 * Anything a budget or a chart calls "spent" is its opposite. A month where
 * refunds outweigh purchases yields a negative spend, which is the truth; only
 * progress bars clamp it.
 */
export function spentFor(total: number): number {
  return -total;
}

/**
 * Spend per category id. Rows are grouped by currency as well as category, so a
 * category can appear more than once — hence the accumulate rather than assign.
 * Summing across currencies is the same single-currency assumption net worth
 * already makes on Home.
 *
 * Rows with no category are skipped: a budget is keyed by category, so there is
 * nothing to attribute them to. Ingest always resolves at least `uncategorized`,
 * so in practice there are none.
 */
export function spentByCategory(rows: MonthlyTotal[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.category_id) continue;
    out.set(row.category_id, (out.get(row.category_id) ?? 0) + spentFor(row.total));
  }
  return out;
}

export type CashFlowMonth = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

/**
 * Income and expense per month, with transfers EXCLUDED — the whole reason
 * categories.kind was added in Phase 2. A transfer between two linked accounts
 * nets to zero and would be harmless, but a transfer out to an account we do not
 * have is a one-legged negative row that would read as a real expense.
 *
 * Built from `months` rather than from `rows`: a month with no transactions
 * produces no row at all, and a chart with a hole in it is worse than one with a
 * zero.
 */
export function buildCashFlow(
  rows: MonthlyTotal[],
  months: string[],
  categoriesById: CategoriesById,
): CashFlowMonth[] {
  const byMonth = new Map<string, CashFlowMonth>(
    months.map((month) => [month, { month, income: 0, expense: 0, net: 0 }]),
  );

  for (const row of rows) {
    const entry = byMonth.get(row.month);
    if (!entry) continue;
    // No category means no kind to read; `uncategorized` is seeded as an expense,
    // so that is the honest default.
    const kind = (row.category_id && categoriesById.get(row.category_id)?.kind) || 'expense';
    if (kind === 'income') entry.income += row.total;
    else if (kind === 'expense') entry.expense += spentFor(row.total);
  }

  for (const entry of byMonth.values()) entry.net = entry.income - entry.expense;
  return months.map((month) => byMonth.get(month)!);
}

export type CategorySlice = {
  id: string;
  name: string;
  color: string;
  icon: string;
  spent: number;
  /** Fraction of the month's total spend, 0–1. */
  share: number;
};

/**
 * Expense categories for one month, biggest first, ready for the donut and the
 * list beneath it. Income and transfers are dropped, as are categories that came
 * out non-positive (a month of pure refunds), which would otherwise draw a
 * negative arc.
 */
export function buildCategorySlices(
  rows: MonthlyTotal[],
  categoriesById: CategoriesById,
): CategorySlice[] {
  const spentById = new Map<string, number>();

  for (const row of rows) {
    const category = row.category_id ? categoriesById.get(row.category_id) : undefined;
    if (category && category.kind !== 'expense') continue;
    const key = row.category_id ?? NO_CATEGORY;
    spentById.set(key, (spentById.get(key) ?? 0) + spentFor(row.total));
  }

  const slices = [...spentById]
    .filter(([, spent]) => spent > 0)
    .map(([id, spent]) => {
      const category = categoriesById.get(id);
      return {
        id,
        name: category?.name ?? 'Uncategorized',
        color: category?.color ?? '#94A198',
        icon: category?.icon ?? 'CircleDashed',
        spent,
        share: 0,
      };
    })
    .sort((a, b) => b.spent - a.spent);

  const total = slices.reduce((sum, slice) => sum + slice.spent, 0);
  return total === 0 ? slices : slices.map((slice) => ({ ...slice, share: slice.spent / total }));
}
