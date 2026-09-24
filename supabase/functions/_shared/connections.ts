/**
 * Disconnecting a bank, and refusing to connect one twice. The decisions are
 * pure and pinned by connections.test.ts; disconnectItem does the I/O.
 * See the Phase 6 spec.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { claimItem, describeError } from './sync.ts';

export type DisconnectMode = 'archive' | 'delete';
export type DisconnectPlan = 'noop' | 'delete_local' | 'remove_then_archive' | 'remove_then_delete';
export type DisconnectResult = 'ok' | 'busy' | 'plaid_failed';

export function planDisconnect(status: string, mode: DisconnectMode): DisconnectPlan {
  switch (status) {
    case 'active':
    case 'login_required':
      // A broken Item can still be removed at Plaid — and must be: it still bills.
      return mode === 'archive' ? 'remove_then_archive' : 'remove_then_delete';
    case 'archived':
      // Its token is already gone, so there is nothing left to tell Plaid.
      return mode === 'archive' ? 'noop' : 'delete_local';
    default:
      // plaid_items_status_check makes this unreachable, so fail loudly.
      throw new Error(`unknown item status: ${status}`);
  }
}

/**
 * Plaid's code for an Item "previously removed via /item/remove, or [that] has
 * had access removed by the user". Removal is then already done, so the
 * disconnect may proceed. Every other error — a network error with no
 * response included — must leave the Item connected: the token is the only
 * way left to stop its billing.
 */
export function isItemGone(err: unknown): boolean {
  const code = (err as { response?: { data?: { error_code?: string } } } | undefined)
    ?.response?.data?.error_code;
  return code === 'ITEM_NOT_FOUND';
}

export type LinkedAccount = { name?: string | null; mask?: string | null };

const fold = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Plaid's duplicate-Item rule: the same institution plus an account with the
 * same name and mask. `existing` is the user's accounts on LIVE Items at the
 * incoming institution — archived ones never block, or "Keep history" would
 * lock the user out of that bank. When Link sends no masks at all, Plaid's
 * fallback applies: the same institution for the same user is enough.
 */
export function isDuplicateLink(existing: LinkedAccount[], incoming: LinkedAccount[]): boolean {
  if (existing.length === 0) return false;
  const masked = incoming.filter((a) => fold(a.mask) !== '');
  if (masked.length === 0) return true;
  return masked.some((i) =>
    existing.some((e) => fold(e.mask) === fold(i.mask) && fold(e.name) === fold(i.name))
  );
}

/**
 * Disconnect one Item. Plaid first: local state changes only once
 * /item/remove succeeds or says the Item is already gone. The token is the
 * only way to stop the billing, so deleting it after a transient error would
 * leak a billed Item forever. Throws on a database error.
 */
export async function disconnectItem(
  admin: SupabaseClient,
  plaid: PlaidApi,
  item: { id: string; status: string },
  mode: DisconnectMode,
): Promise<DisconnectResult> {
  const plan = planDisconnect(item.status, mode);
  if (plan === 'noop') return 'ok';

  if (plan === 'delete_local') {
    // No claim needed: claimItem never claims an archived Item, so no sync can race this.
    const { error } = await admin.from('plaid_items').delete().eq('id', item.id).eq('status', 'archived');
    if (error) throw error;
    return 'ok';
  }

  // The same claim as syncItem: a sync finishing after an archive would write
  // rows and set status back to 'active'.
  if (!(await claimItem(admin, item.id))) return 'busy';
  const release = () => admin.from('plaid_items').update({ sync_locked_at: null }).eq('id', item.id);

  try {
    const { data: tokenRow, error: tokenError } = await admin
      .from('plaid_tokens').select('access_token').eq('item_id', item.id).maybeSingle();
    if (tokenError) throw tokenError;

    // No token: an earlier attempt already removed the Item at Plaid, then
    // stopped before archiving. Continue from where it stopped.
    if (tokenRow) {
      try {
        await plaid.itemRemove({ access_token: tokenRow.access_token });
      } catch (err) {
        if (!isItemGone(err)) {
          console.error(`item/remove failed for item ${item.id}: ${describeError(err)}`);
          await release();
          return 'plaid_failed';
        }
      }
    }

    if (plan === 'remove_then_delete') {
      // The cascade covers plaid_tokens, accounts, and through them
      // transactions, balance_snapshots and recurring_streams.
      const { error } = await admin.from('plaid_items').delete().eq('id', item.id);
      if (error) throw error;
      return 'ok';
    }

    // remove_then_archive. Status goes LAST: a crash before it leaves a live,
    // retryable Item whose next attempt finds no token (or ITEM_NOT_FOUND).
    const { error: tokenDeleteError } = await admin.from('plaid_tokens').delete().eq('item_id', item.id);
    if (tokenDeleteError) throw tokenDeleteError;

    const { data: accounts, error: accountsError } = await admin
      .from('accounts').select('id').eq('item_id', item.id);
    if (accountsError) throw accountsError;
    const accountIds = (accounts ?? []).map((a) => a.id);

    if (accountIds.length > 0) {
      // Dismissed or not: an archived Item never re-detects, so a dismissal has
      // nothing left to protect.
      const { error: streamsError } = await admin
        .from('recurring_streams').delete().in('account_id', accountIds);
      if (streamsError) throw streamsError;

      // Today's rows (UTC, the snapshot clock) still count this bank. Dropping
      // them makes the chart's last point equal Home's hero; earlier days keep it.
      const { error: snapshotError } = await admin
        .from('balance_snapshots').delete()
        .in('account_id', accountIds)
        .eq('date', new Date().toISOString().slice(0, 10));
      if (snapshotError) throw snapshotError;
    }

    const { error: archiveError } = await admin
      .from('plaid_items')
      .update({ status: 'archived', sync_cursor: null, sync_locked_at: null })
      .eq('id', item.id);
    if (archiveError) throw archiveError;
    return 'ok';
  } catch (err) {
    await release();
    throw err;
  }
}
