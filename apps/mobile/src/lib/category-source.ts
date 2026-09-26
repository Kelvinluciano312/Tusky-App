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

/** For a Tusky guess, how it was made ("Tusky guessed this …"); null when it is not a guess. */
export function guessHint(source: string): string | null {
  return GUESS_HINTS[source] ?? null;
}

/** Who set the category, for the transaction screen. */
export function setBy(source: string): string {
  return SET_BY[source] ?? 'Tusky';
}
