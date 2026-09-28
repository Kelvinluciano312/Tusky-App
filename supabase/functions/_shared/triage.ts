/**
 * Per-row triage (Phase 12d): how likely it is that a new row needs the user's
 * attention in the review deck, and, in a shared herd, whether it looks like a
 * shared household expense. One Jev request per row carries both. Pure except
 * the JevAsk that runTriagePass (sync.ts) is given.
 *
 * Per row and per herd, so nothing here is cached. Unlike a category, "worth a
 * second look" and "shared" depend on this household.
 */
import { type JevQuestion, type JevResponse, readNoul, readScore } from './jev.ts';

/** New rows judged per sync, newest first. The rest wait for the next sync. */
export const TRIAGE_PER_SYNC = 50;
/**
 * The Noul at which a split is suggested. Above 0.5 on purpose: a wrong hint
 * costs only attention, and sparing attention is the point of the feature.
 */
export const SPLIT_SUGGEST_AT = 0.7;
/** review_priority's levels, 0..2. The app puts 2 first and marks it. */
export const PRIORITY_LEVELS = [
  'Routine: an ordinary purchase whose category clearly fits the merchant',
  'Worth a glance: an unfamiliar merchant, an unusual amount, or a category that may not fit',
  'Likely needs a fix: the category looks wrong for this merchant, or the charge looks like a duplicate, a refund or a mistake',
];

export type TriageRow = {
  id: string;
  name: string;
  merchant_name: string | null;
  /** Signed: positive is money in. */
  amount: number;
  category_name: string | null;
  category_source: string;
  is_private: boolean;
  split: Record<string, number> | null;
};

export type Triage = { id: string; review_priority: number; split_suggested: boolean | null };

/**
 * Whether to ask about sharing at all. It needs a shared herd, a shared account
 * (private rows never count toward settle-up), money out, and no split chosen yet.
 */
export function asksSplit(row: TriageRow, shared: boolean): boolean {
  return shared && !row.is_private && row.amount < 0 && row.split === null;
}

/** What Jev sees about one row: the row itself and the household's size, nothing that names anyone. */
export function triageState(row: TriageRow, herdSize: number) {
  return {
    merchant: row.merchant_name ?? '(unknown)',
    description: row.name,
    amount: Math.abs(row.amount).toFixed(2),
    direction: row.amount > 0 ? 'money in' : 'money out',
    category: row.category_name ?? 'Uncategorized',
    category_set_by: row.category_source,
    household_size: herdSize,
  };
}

/**
 * The questions for one row. The split Noul is added only when it can matter
 * (speculative fan-out), so a solo herd never pays for it.
 */
export function triageQuestions(row: TriageRow, shared: boolean): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    review_priority: {
      type: 'score',
      instructions: 'How likely is it that the user needs to check or fix this bank transaction?',
      criteria: PRIORITY_LEVELS,
    },
  };
  if (asksSplit(row, shared)) {
    questions.is_shared_expense = {
      type: 'noul',
      instructions: 'Is this a shared household expense that the members of the household would split?',
      criteria: {
        true: 'Rent, utilities, groceries, household supplies, a shared subscription, or a meal or trip together',
        false: "One person's own purchase or subscription, a transfer, income, or anything only one person uses",
      },
    };
  }
  return questions;
}

/**
 * Read one row's answers. Null when the priority is unreadable, so the row is
 * left whole for the next sync rather than half-judged. The Score's position
 * is rounded to its nearest level.
 */
export function readTriage(row: TriageRow, response: JevResponse, shared: boolean): Triage | null {
  const priority = readScore(response.answers.review_priority);
  if (!priority) return null;
  const top = PRIORITY_LEVELS.length - 1;
  const review_priority = Math.min(top, Math.max(0, Math.round(priority.score)));

  let split_suggested: boolean | null = null;
  if (asksSplit(row, shared)) {
    const yes = readNoul(response.answers.is_shared_expense);
    split_suggested = yes === null ? null : yes >= SPLIT_SUGGEST_AT;
  }
  return { id: row.id, review_priority, split_suggested };
}

/** Group results by what they write: at most six statements a sync, not one per row. */
export function groupTriage(
  results: Triage[],
): { review_priority: number; split_suggested: boolean | null; ids: string[] }[] {
  const groups = new Map<string, { review_priority: number; split_suggested: boolean | null; ids: string[] }>();
  for (const r of results) {
    const key = `${r.review_priority}|${r.split_suggested}`;
    const group = groups.get(key) ??
      { review_priority: r.review_priority, split_suggested: r.split_suggested, ids: [] };
    group.ids.push(r.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}
