/**
 * Disconnecting a bank, and refusing to connect one twice. The decisions are
 * pure and pinned by connections.test.ts; disconnectItem does the I/O.
 * See the Phase 6 spec.
 */

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
