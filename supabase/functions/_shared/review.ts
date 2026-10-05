/**
 * Pending → posted carry-forward (Phase 8). Plaid posts a pending transaction
 * under a NEW transaction_id whose pending_transaction_id points at the old
 * one, then removes the old one. Without this, the user's manual category and
 * memo on the pending row are lost. syncItem does the I/O.
 */

export type ExistingRow = {
  plaid_transaction_id: string;
  category_id: string | null;
  category_is_manual: boolean;
  notes: string | null;
  /** Who paid (Phase 9d); null = Joint. */
  paid_by: string | null;
  paid_by_is_manual: boolean;
  /** A custom split (Phase 11b): member id → percent. Null = none. */
  split: Record<string, number> | null;
  /** Which source a hand-picked category corrected (Phase 12a); null = none. */
  corrected_from: string | null;
  /** Where the current category came from (Phase 12a), so an `ai` answer survives a modify. */
  category_source: string;
};

/** Who a purchase was for, as picked by hand: a person, Joint (null), or a split. */
export type CarriedPayer = {
  plaid_transaction_id: string;
  paid_by: string | null;
  split: Record<string, number> | null;
};

export type IncomingTxn = { transaction_id: string; pending_transaction_id?: string | null };

/**
 * For each incoming transaction: the row whose user data it keeps. That is its
 * own row when it has one, otherwise its pending predecessor. Also returns the
 * memos and hand-picked payers to copy onto new rows. Neither can ride in the
 * bulk upsert: supabase-js sends the union of the rows' keys, which would null
 * every other row's memo, and the database sets every other row's payer.
 */
export function carryForward(
  incoming: IncomingTxn[],
  existingByPlaidId: Map<string, ExistingRow>,
): {
  existingFor: Map<string, ExistingRow | null>;
  notes: { plaid_transaction_id: string; notes: string }[];
  payers: CarriedPayer[];
} {
  const existingFor = new Map<string, ExistingRow | null>();
  const notes: { plaid_transaction_id: string; notes: string }[] = [];
  const payers: CarriedPayer[] = [];
  for (const t of incoming) {
    const own = existingByPlaidId.get(t.transaction_id);
    if (own) {
      existingFor.set(t.transaction_id, own);
      continue;
    }
    const predecessor = t.pending_transaction_id ? existingByPlaidId.get(t.pending_transaction_id) : undefined;
    existingFor.set(t.transaction_id, predecessor ?? null);
    if (predecessor?.notes) notes.push({ plaid_transaction_id: t.transaction_id, notes: predecessor.notes });
    if (predecessor?.paid_by_is_manual) {
      payers.push({ plaid_transaction_id: t.transaction_id, paid_by: predecessor.paid_by, split: predecessor.split });
    }
  }
  return { existingFor, notes, payers };
}

/**
 * Only the last two weeks go to review (Phase 16b). A row sync inserts whose
 * date is older than this many days before its Item was linked is marked
 * reviewed (`auto_reviewed`), so the queue starts with recent transactions
 * instead of the bank's whole history.
 */
export const REVIEW_WINDOW_DAYS = 14;

/**
 * The first date (YYYY-MM-DD, UTC) that still goes to review: a row dated
 * before it is outside the window. The SQL backfill in the 16b migration
 * computes the same day.
 */
export function reviewCutoff(itemCreatedAt: string | Date): string {
  const created = new Date(itemCreatedAt);
  if (Number.isNaN(created.getTime())) throw new Error(`invalid item created_at: ${String(itemCreatedAt)}`);
  const day = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  return new Date(day - REVIEW_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Which of the rows a sync just wrote to mark reviewed: truly new rows (no row
 * of their own and no pending predecessor, whose review state is the user's),
 * posted, and dated before the cutoff. YYYY-MM-DD strings compare as dates.
 */
export function autoReviewIds(
  rows: { plaid_transaction_id: string; date: string; pending: boolean }[],
  existingFor: Map<string, ExistingRow | null>,
  cutoff: string,
): string[] {
  return rows
    .filter((r) => !r.pending && r.date < cutoff && existingFor.get(r.plaid_transaction_id) === null)
    .map((r) => r.plaid_transaction_id);
}
