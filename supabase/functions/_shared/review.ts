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
};

export type CarriedPayer = { plaid_transaction_id: string; paid_by: string | null };

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
      payers.push({ plaid_transaction_id: t.transaction_id, paid_by: predecessor.paid_by });
    }
  }
  return { existingFor, notes, payers };
}
