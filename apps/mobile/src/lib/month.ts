/**
 * Month helpers. There is no date library in this repo and Phase 3 is not the
 * place to add one: a month is a 'YYYY-MM-01' string everywhere, the same shape
 * the `date` columns already arrive in.
 *
 * Every parse appends T00:00:00. A bare 'YYYY-MM-DD' is parsed as UTC, which
 * lands on the previous day — and so possibly the previous month — anywhere west
 * of Greenwich. Same idiom as formatSectionDate on the transactions screen.
 */

/** 'YYYY-MM-01' for the month containing `date`. */
export function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export function currentMonthStart(): string {
  return monthStart(new Date());
}

/** Shift a month string by `n` months; `n` may be negative. */
export function addMonths(month: string, n: number): string {
  const [year, m] = month.split('-').map(Number);
  // Date normalizes an out-of-range month, so December + 1 rolls into January.
  return monthStart(new Date(year, m - 1 + n, 1));
}

/** The `count` months ending at `month`, oldest first. */
export function monthsEndingAt(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(month, i - (count - 1)));
}

/** 'September 2026' */
export function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** 'Sep' — for axis labels, where the full name never fits. */
export function monthShortLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
}
