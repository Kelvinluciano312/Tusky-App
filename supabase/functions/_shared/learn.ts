/**
 * Learning from a herd's own fixes (Phase 12a). Pure: callers load the labels.
 *
 * A label is a transaction with the same merchant_key that the user categorized
 * by hand, or whose guess (GUESSED_SOURCES) they accepted in review. Labels are
 * compared by amount on a log scale, so a $4 coffee sits near a $6 one and far
 * from a $50 fill-up: one merchant can teach two categories.
 */

/** The sources that are Tusky's guesses: accepting one in review makes it a label. */
export const GUESSED_SOURCES = ['learned', 'community', 'ai'] as const;

export const LEARN = {
  /** Only the most recent labels of the same direction count. */
  RECENT: 10,
  /** Fewer labels than this teach nothing. */
  MIN_LABELS: 2,
  /** How many nearest labels vote. */
  K: 5,
  /** The winner needs at least this many votes... */
  MIN_VOTES: 2,
  /** ...and at least this share of the voters. Over a half, so a tie never wins. */
  MIN_SHARE: 2 / 3,
  /** Labels further than 3x (or 1/3) the amount do not vote. */
  MAX_DISTANCE: Math.log(3),
} as const;

export type Label = {
  /** Signed like transactions.amount: positive = money in. */
  amount: number;
  category_id: string;
  /** The transaction's date (YYYY-MM-DD): recency. */
  date: string;
  /** Who connected the account ("connected by"). */
  user_id: string;
  /** Whether the account is private to its connector. */
  is_private: boolean;
};

/**
 * The labels that may teach a row connected by `connectorId`. A member's
 * private-account fixes teach only their own private rows: a guess on a shared
 * row is visible to the whole herd, so a herd mate could infer them from it.
 */
export function usableLabels(labels: Label[], connectorId: string, rowIsPrivate: boolean): Label[] {
  return labels.filter((l) => !l.is_private || (rowIsPrivate && l.user_id === connectorId));
}

const size = (amount: number) => Math.log1p(Math.abs(amount));

/** The category this merchant's labels give a transaction of `amount`, or null. */
export function learnedCategory(labels: Label[], amount: number): string | null {
  const moneyIn = amount > 0;
  const recent = labels
    .filter((l) => (l.amount > 0) === moneyIn)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, LEARN.RECENT);
  if (recent.length < LEARN.MIN_LABELS) return null;

  const x = size(amount);
  const near = recent
    .map((l) => ({ l, d: Math.abs(size(l.amount) - x) }))
    .filter(({ d }) => d <= LEARN.MAX_DISTANCE)
    .sort((a, b) => a.d - b.d)
    .slice(0, LEARN.K);

  const votes = new Map<string, number>();
  for (const { l } of near) votes.set(l.category_id, (votes.get(l.category_id) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [category, n] of votes) {
    if (n > most) [best, most] = [category, n];
  }
  if (most < LEARN.MIN_VOTES || most < LEARN.MIN_SHARE * near.length) return null;
  return best;
}
