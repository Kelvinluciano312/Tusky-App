import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

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

const ROW_COLUMNS =
  'id, date, amount, merchant_key, category_id, category_is_manual, notes, paid_by, paid_by_is_manual, split, reviewed_at';

/** Every row of one account, past PostgREST's 1000-row page. */
async function allRows(admin: SupabaseClient, accountId: string, from?: string): Promise<MergeRow[]> {
  const out: MergeRow[] = [];
  for (let page = 0; ; page++) {
    let q = admin.from('transactions').select(ROW_COLUMNS).eq('account_id', accountId);
    if (from) q = q.gte('date', from);
    const { data, error } = await q.order('id').range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as MergeRow[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Merge this Item's accounts with archived twins: same institution, same
 * herd, same connector (so another member's private history never moves).
 * Cheap when there is nothing to merge: one query. Throws on a database
 * error; syncItem catches it.
 */
export async function mergeReconnected(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
): Promise<number> {
  const { data: self, error: selfError } = await admin
    .from('plaid_items').select('institution_id').eq('id', item.id).single();
  if (selfError) throw selfError;
  if (!self?.institution_id) return 0;

  const { data: archived, error: archivedError } = await admin
    .from('accounts')
    .select('id, name, mask, plaid_items!inner(institution_id, status)')
    .eq('herd_id', item.herd_id)
    .eq('user_id', item.user_id)
    .eq('plaid_items.institution_id', self.institution_id)
    .eq('plaid_items.status', 'archived');
  if (archivedError) throw archivedError;
  if (!archived || archived.length === 0) return 0;

  const { data: fresh, error: freshError } = await admin
    .from('accounts').select('id, name, mask').eq('item_id', item.id);
  if (freshError) throw freshError;
  const pairs = pairAccounts(fresh ?? [], archived);
  if (pairs.length === 0) return 0;

  const { data: memberRows, error: memberError } = await admin
    .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
  if (memberError) throw memberError;
  const members = new Set((memberRows ?? []).map((m) => m.user_id as string));

  let replaced = 0;
  for (const pair of pairs) {
    const newRows = await allRows(admin, pair.fresh);
    if (newRows.length === 0) continue;
    const start = newRows.reduce((m, r) => (r.date < m ? r.date : m), newRows[0].date);
    const oldRows = await allRows(admin, pair.archived, start);
    const plan = planMerge(oldRows, newRows, members);
    for (const u of plan.updates) {
      const { error } = await admin.from('transactions').update(u.patch).eq('id', u.id);
      if (error) throw error;
    }
    for (let k = 0; k < plan.deleteIds.length; k += 200) {
      const { error } = await admin.from('transactions').delete().in('id', plan.deleteIds.slice(k, k + 200));
      if (error) throw error;
    }
    replaced += plan.deleteIds.length;
  }
  return replaced;
}
