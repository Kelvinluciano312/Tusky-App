// The transaction feed's filters (Phase 15e). Pure: the screen keeps state,
// this decides what matches and what the active-filter chips say.

export type Direction = 'any' | 'out' | 'in';
/** Who spent it: everyone, a member, or Joint (null). */
export type SpentBy = string | null | 'all';

export type Filters = {
  /** A category, or a group (then its children match too). */
  category: string | null;
  /** A merchant_key; '' never matches (names with no letters). */
  merchant: string | null;
  /** On the absolute amount, in the account's currency. */
  min: number | null;
  max: number | null;
  direction: Direction;
  account: string | null;
  spentBy: SpentBy;
};

export const NO_FILTERS: Filters = {
  category: null,
  merchant: null,
  min: null,
  max: null,
  direction: 'any',
  account: null,
  spentBy: 'all',
};

type Row = {
  name: string;
  merchant_name: string | null;
  merchant_key: string | null;
  amount: number;
  account_id: string;
  category_id: string | null;
  paid_by: string | null;
};

/** Parent of a category, or the category itself when it is a group. */
export type GroupOf = (categoryId: string) => string;

export function isFiltered(f: Filters): boolean {
  return (
    f.category !== null ||
    f.merchant !== null ||
    f.min !== null ||
    f.max !== null ||
    f.direction !== 'any' ||
    f.account !== null ||
    f.spentBy !== 'all'
  );
}

export function matchesSearch(row: Pick<Row, 'merchant_name' | 'name'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.merchant_name ?? ''} ${row.name}`.toLowerCase().includes(q);
}

export function matchesFilters(row: Row, f: Filters, groupOf: GroupOf): boolean {
  if (f.category !== null) {
    if (row.category_id === null) return false;
    if (row.category_id !== f.category && groupOf(row.category_id) !== f.category) return false;
  }
  if (f.merchant !== null && (row.merchant_key ?? '') !== f.merchant) return false;
  if (f.direction === 'out' && row.amount >= 0) return false;
  if (f.direction === 'in' && row.amount <= 0) return false;
  const size = Math.abs(row.amount);
  if (f.min !== null && size < f.min) return false;
  if (f.max !== null && size > f.max) return false;
  if (f.account !== null && row.account_id !== f.account) return false;
  if (f.spentBy !== 'all' && row.paid_by !== f.spentBy) return false;
  return true;
}

/** A typed amount: blank or unparseable means no bound; commas read as decimal points. */
export function parseAmount(text: string): number | null {
  const n = Number(text.trim().replace(/[$\s]/g, '').replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

const money = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`;

export type ActiveChip = { key: keyof Filters | 'amount'; label: string };

/** One removable chip per active filter, in the sheet's order. */
export function activeChips(
  f: Filters,
  names: {
    category: (id: string) => string;
    merchant: (key: string) => string;
    account: (id: string) => string;
    person: (id: string | null) => string;
  },
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (f.direction !== 'any') chips.push({ key: 'direction', label: f.direction === 'out' ? 'Money out' : 'Money in' });
  if (f.category !== null) chips.push({ key: 'category', label: names.category(f.category) });
  if (f.merchant !== null) chips.push({ key: 'merchant', label: names.merchant(f.merchant) });
  if (f.min !== null || f.max !== null) {
    const label =
      f.min !== null && f.max !== null
        ? `${money(f.min)}–${money(f.max)}`
        : f.min !== null
          ? `Over ${money(f.min)}`
          : `Under ${money(f.max!)}`;
    chips.push({ key: 'amount', label });
  }
  if (f.account !== null) chips.push({ key: 'account', label: names.account(f.account) });
  if (f.spentBy !== 'all') chips.push({ key: 'spentBy', label: `Spent by ${names.person(f.spentBy)}` });
  return chips;
}

/** Clear what one chip stands for. */
export function withoutChip(f: Filters, key: ActiveChip['key']): Filters {
  if (key === 'amount') return { ...f, min: null, max: null };
  return { ...f, [key]: NO_FILTERS[key] };
}

/** Merchants seen in the loaded rows, most frequent first, for the merchant picker. */
export function merchantOptions(rows: Row[], display: (row: Row) => string): { key: string; name: string; count: number }[] {
  const byKey = new Map<string, { key: string; name: string; count: number }>();
  for (const row of rows) {
    const key = row.merchant_key ?? '';
    if (!key) continue;
    const seen = byKey.get(key);
    if (seen) seen.count += 1;
    else byKey.set(key, { key, name: display(row), count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
