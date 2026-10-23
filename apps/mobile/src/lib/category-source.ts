/**
 * Words for where a transaction's category came from (Phase 12,
 * transactions.category_source). Takes a plain string: the server may add
 * sources before the app knows them.
 */

const GUESS_HINTS: Record<string, string> = {
  learned: 'from your past choices',
  community: 'from other Tusky users',
  ai: 'with AI',
};

const SET_BY: Record<string, string> = {
  manual: 'You',
  rule: 'Your rule',
  learned: 'Your past choices',
  community: 'Other Tusky users',
  ai: 'AI',
  plaid: 'Your bank (via Plaid)',
  fallback: 'No match yet',
};

/** Short label under the category on the review card. */
const SOURCE_LINE: Record<string, string> = {
  manual: 'Set by you',
  rule: 'Your rule',
  learned: 'Learned',
  community: 'Community',
  ai: 'AI',
  plaid: 'Plaid',
  fallback: 'No match yet',
};

/** For a Tusky guess, how it was made ("Tusky guessed this …"); null when it is not a guess. */
export function guessHint(source: string): string | null {
  return GUESS_HINTS[source] ?? null;
}

/**
 * Who set the category, for the transaction screen. A herd member's name
 * replaces "You" when that person answered an ask by choosing the category.
 */
export function setBy(source: string, person?: string | null): string {
  if (person && source === 'manual') return person;
  return SET_BY[source] ?? 'Tusky';
}

/**
 * The review card's one quiet line for where the category came from.
 * A person's name only when they chose it (source `manual`); a confirmation
 * of Plaid or AI stays that source.
 */
export function sourceLine(source: string, person?: string | null): string {
  if (person && source === 'manual') return `Set by ${person}`;
  return SOURCE_LINE[source] ?? 'Tusky';
}
