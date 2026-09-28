/**
 * Reconnecting merges the history (Phase 14b). A bank reconnected after its
 * plan lapsed is a new Plaid Item whose history overlaps the kept one. The new
 * copy is the complete one, so in the overlap each kept row hands its edits to
 * its twin and is deleted. Older kept rows stay. Pure; mergeReconnected does the I/O.
 */

export type MergeAccount = { id: string; name: string | null; mask: string | null };

export type MergeRow = {
  id: string;
  date: string;
  amount: number;
  merchant_key: string | null;
  category_id: string | null;
  category_is_manual: boolean;
  notes: string | null;
  paid_by: string | null;
  paid_by_is_manual: boolean;
  split: Record<string, number> | null;
  reviewed_at: string | null;
};

const fold = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** New accounts matched to archived ones: same name and mask (isDuplicateLink's rule). */
export function pairAccounts(fresh: MergeAccount[], archived: MergeAccount[]): { fresh: string; archived: string }[] {
  const pairs: { fresh: string; archived: string }[] = [];
  for (const f of fresh) {
    for (const a of archived) {
      if (fold(a.name) === fold(f.name) && fold(a.mask) === fold(f.mask)) pairs.push({ fresh: f.id, archived: a.id });
    }
  }
  return pairs;
}

const keyOf = (r: MergeRow) => `${r.date}|${r.amount}|${r.merchant_key ?? ''}`;

export function planMerge(
  oldRows: MergeRow[],
  newRows: MergeRow[],
  members: Set<string>,
): { updates: { id: string; patch: Record<string, unknown> }[]; deleteIds: string[] } {
  if (newRows.length === 0) return { updates: [], deleteIds: [] };
  const start = newRows.reduce((m, r) => (r.date < m ? r.date : m), newRows[0].date);
  const byId = (x: MergeRow, y: MergeRow) => (x.id < y.id ? -1 : 1);
  const overlap = oldRows.filter((r) => r.date >= start).sort(byId);

  const twins = new Map<string, MergeRow[]>();
  for (const r of [...newRows].sort(byId)) {
    const k = keyOf(r);
    twins.set(k, [...(twins.get(k) ?? []), r]);
  }

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const o of overlap) {
    const twin = twins.get(keyOf(o))?.shift();
    if (!twin) continue;
    const patch: Record<string, unknown> = {};
    if (o.category_is_manual && !twin.category_is_manual) {
      patch.category_id = o.category_id;
      patch.category_is_manual = true;
    }
    if (o.notes && !twin.notes) patch.notes = o.notes;
    const peopleStay = (o.paid_by === null || members.has(o.paid_by)) &&
      (o.split === null || Object.keys(o.split).every((id) => members.has(id)));
    if (o.paid_by_is_manual && !twin.paid_by_is_manual && peopleStay) {
      patch.paid_by = o.split ? null : o.paid_by;
      patch.paid_by_is_manual = true;
      patch.split = o.split;
    }
    if (o.reviewed_at && !twin.reviewed_at) patch.reviewed_at = o.reviewed_at;
    if (Object.keys(patch).length > 0) updates.push({ id: twin.id, patch });
  }
  return { updates, deleteIds: overlap.map((r) => r.id) };
}
