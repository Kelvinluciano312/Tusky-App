import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { buildSnapshotRows, syncAccounts } from './accounts.ts';
import { type CategoryMap, pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';
import { refreshRecurring } from './recurring.ts';

const PAGE_SIZE = 500;
const FIRST_SYNC_DAYS = 90;
const MAX_MUTATION_RETRIES = 3;
/** A claim older than this is treated as abandoned by a dead invocation. */
const STALE_CLAIM_MS = 5 * 60_000;

export type ItemStatus = 'synced' | 'skipped' | 'login_required' | 'error';

export type ItemResult = {
  item_id: string;
  status: ItemStatus;
  added: number;
  modified: number;
  removed: number;
  /** Plaid error_code or a short reason, so the client can say what broke. */
  message?: string;
};

/** Everything a sync needs that is the same for every Item. */
export type SyncContext = {
  admin: SupabaseClient;
  plaid: PlaidApi;
  categoryMap: CategoryMap;
  fallbackId: string;
  /** Categories of kind 'transfer' — recurring detection ignores them. */
  transferCategoryIds: string[];
};

/** Plaid SDK errors carry the useful detail on response.data. */
function describeError(err: unknown): string {
  const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
    ?.response?.data;
  if (data?.error_code) return `${data.error_code}: ${data.error_message ?? ''}`.trim();
  return (err as Error)?.message ?? 'unknown error';
}

/** Marker so an already-recorded failure isn't recorded twice by the catch. */
const HANDLED = '__handled__';

/** Loads the taxonomy once per invocation. Throws if it cannot. */
export async function loadSyncContext(admin: SupabaseClient, plaid: PlaidApi): Promise<SyncContext> {
  const { data: mapRows, error: mapError } = await admin
    .from('plaid_category_map')
    .select('pfc_primary, category_id');
  if (mapError) throw new Error(`failed to load category map: ${mapError.message}`);
  const categoryMap: CategoryMap = Object.fromEntries(
    (mapRows ?? []).map((r) => [r.pfc_primary, r.category_id]),
  );

  const { data: fallback, error: fallbackError } = await admin
    .from('categories').select('id').eq('slug', 'uncategorized').single();
  if (fallbackError || !fallback) {
    throw new Error(`uncategorized category missing: ${fallbackError?.message ?? 'no row'}`);
  }

  const { data: transferRows, error: transferError } = await admin
    .from('categories').select('id').eq('kind', 'transfer');
  if (transferError) throw new Error(`failed to load transfer categories: ${transferError.message}`);

  return {
    admin,
    plaid,
    categoryMap,
    fallbackId: fallback.id,
    transferCategoryIds: (transferRows ?? []).map((r) => r.id),
  };
}

/**
 * Sync one Item. Shared by the user-triggered sync and the Plaid webhook, so
 * both paths claim, retry, preserve manual categories and advance the cursor
 * the same way. Never throws: failures come back as an ItemResult.
 */
export async function syncItem(
  ctx: SyncContext,
  item: { id: string; user_id: string },
): Promise<ItemResult> {
  const { admin, plaid, categoryMap, fallbackId, transferCategoryIds } = ctx;
  const base: ItemResult = { item_id: item.id, status: 'synced', added: 0, modified: 0, removed: 0 };
  let result: ItemResult = base;

  // Claim the item: atomic, survives across HTTP calls, self-heals when stale.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: claimed } = await admin
    .from('plaid_items')
    .update({ sync_locked_at: new Date().toISOString() })
    .eq('id', item.id)
    .or(`sync_locked_at.is.null,sync_locked_at.lt.${staleBefore}`)
    .select('id, sync_cursor')
    .maybeSingle();

  if (!claimed) return { ...base, status: 'skipped' };

  try {
    const { data: tokenRow, error: tokenError } = await admin
      .from('plaid_tokens').select('access_token').eq('item_id', item.id).single();
    if (tokenError || !tokenRow) throw new Error('access token missing');

    const accessToken: string = tokenRow.access_token;
    const startCursor: string | null = claimed.sync_cursor;

    // BEFORE the account map below, deliberately. The map is what decides which
    // transactions we keep, and the cursor advances whether or not one was
    // dropped — so without this, a newly-opened account's first transactions are
    // lost for good. Refreshing balances is the secondary benefit.
    //
    // Swallowed on purpose. transactionsSync throws the same ITEM_LOGIN_REQUIRED
    // a few lines down, where the one classifier handles it exactly once; if this
    // threw instead, the item would be recorded as `error` and never marked
    // login_required, so Settings would never offer Reconnect. A
    // RATE_LIMIT_EXCEEDED or INSTITUTION_DOWN here would likewise fail a sync
    // that was about to succeed. It must never write plaid_items.status —
    // transactionsSync stays the sole authority on that.
    try {
      await syncAccounts(admin, plaid, accessToken, item.user_id, item.id);
    } catch (err) {
      console.warn(`account refresh failed for item ${item.id}: ${describeError(err)}`);
    }

    const { data: accountRows } = await admin
      .from('accounts').select('id, plaid_account_id').eq('item_id', item.id);
    const accountByPlaidId = new Map<string, string>(
      (accountRows ?? []).map((a) => [a.plaid_account_id, a.id]),
    );

    // deno-lint-ignore no-explicit-any
    let added: any[] = [];
    // deno-lint-ignore no-explicit-any
    let modified: any[] = [];
    let removed: { transaction_id: string }[] = [];
    let finalCursor: string | null = startCursor;

    for (let attempt = 0; attempt < MAX_MUTATION_RETRIES; attempt++) {
      added = []; modified = []; removed = [];
      // ALWAYS restart from startCursor — never from the page that failed.
      let cursor = startCursor;
      let hasMore = true;
      try {
        while (hasMore) {
          const { data } = await plaid.transactionsSync({
            access_token: accessToken,
            cursor: cursor ?? undefined,
            count: PAGE_SIZE,
            // NOTE: options.transactions_url_taxonomy is NOT supported by the
            // Plaid-Version that plaid@30 pins — the API rejects it with
            // UNKNOWN_FIELDS. The account's default PFC taxonomy applies, so
            // resolveCategoryId's uncategorized fallback is what protects us
            // if a primary we don't map shows up.
            ...(cursor ? {} : { options: { days_requested: FIRST_SYNC_DAYS } }),
            // deno-lint-ignore no-explicit-any
          } as any);
          added.push(...data.added);
          modified.push(...data.modified);
          removed.push(...data.removed);
          hasMore = data.has_more;
          cursor = data.next_cursor;
        }
        finalCursor = cursor;
        break;
      } catch (err) {
        const code = (err as { response?: { data?: { error_code?: string } } })
          ?.response?.data?.error_code;
        if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < MAX_MUTATION_RETRIES - 1) {
          continue;
        }
        if (code === 'ITEM_LOGIN_REQUIRED') {
          await admin.from('plaid_items').update({ status: 'login_required' }).eq('id', item.id);
          result = { ...base, status: 'login_required' };
          throw new Error(HANDLED);
        }
        throw err;
      }
    }

    const upserts = [...added, ...modified];
    if (upserts.length > 0) {
      // Read existing rows so a manual override survives re-sync.
      const ids = upserts.map((t) => t.transaction_id);
      const { data: existingRows } = await admin
        .from('transactions')
        .select('plaid_transaction_id, category_id, category_is_manual')
        .in('plaid_transaction_id', ids);
      const existingByPlaidId = new Map(
        (existingRows ?? []).map((r) => [r.plaid_transaction_id, r]),
      );

      const rows = upserts
        .filter((t) => accountByPlaidId.has(t.account_id))
        .map((t) => {
          const incoming = resolveCategoryId(categoryMap, t.personal_finance_category?.primary, fallbackId);
          const existing = existingByPlaidId.get(t.transaction_id) ?? null;
          return {
            user_id: item.user_id,
            account_id: accountByPlaidId.get(t.account_id)!,
            item_id: item.id,
            plaid_transaction_id: t.transaction_id,
            name: t.name,
            merchant_name: t.merchant_name ?? null,
            logo_url: t.logo_url ?? null,
            amount: toSignedAmount(t.amount),
            iso_currency_code: t.iso_currency_code ?? 'USD',
            date: t.date,
            datetime: t.datetime ?? null,
            pending: t.pending ?? false,
            pending_transaction_id: t.pending_transaction_id ?? null,
            payment_channel: t.payment_channel ?? null,
            pfc_primary: t.personal_finance_category?.primary ?? null,
            pfc_detailed: t.personal_finance_category?.detailed ?? null,
            pfc_confidence: t.personal_finance_category?.confidence_level ?? null,
            category_id: pickCategoryId(existing, incoming),
            category_is_manual: existing?.category_is_manual ?? false,
          };
        });

      if (rows.length > 0) {
        const { error } = await admin
          .from('transactions').upsert(rows, { onConflict: 'plaid_transaction_id' });
        if (error) throw error;
      }
    }

    if (removed.length > 0) {
      const { error } = await admin
        .from('transactions').delete()
        .in('plaid_transaction_id', removed.map((r) => r.transaction_id));
      if (error) throw error;
    }

    // Cursor last: a crash before here means the next run re-applies the same
    // window idempotently rather than skipping it. A successful sync also
    // clears a stale login_required — proof the credentials work again.
    await admin
      .from('plaid_items')
      .update({ sync_cursor: finalCursor, status: 'active' })
      .eq('id', item.id);

    result = { ...base, added: added.length, modified: modified.length, removed: removed.length };

    // Last, and after `result` is latched: a failed chart row must not turn a
    // good sync into `status: 'error'`, nor cost a full re-pagination by landing
    // before the cursor advance. Not in `finally` either — that runs on the
    // login_required and error paths too, and a throw there would escape
    // syncItem, breaking the never-throws contract the webhook relies on.
    //
    // Every account of the USER, not just this Item's: otherwise a day where one
    // Item synced and another did not would sum to a partial net worth and the
    // chart would sawtooth. An Item stuck on login_required keeps contributing
    // its last known balance, which is a deliberate carry-forward — stale, but
    // the alternative is the sawtooth. Settings' Reconnect prompt is the fix.
    try {
      const { data: allAccounts } = await admin
        .from('accounts').select('id, current_balance').eq('user_id', item.user_id);
      const snapshots = buildSnapshotRows(allAccounts ?? [], item.user_id);
      if (snapshots.length > 0) {
        const { error } = await admin
          .from('balance_snapshots').upsert(snapshots, { onConflict: 'account_id,date' });
        if (error) throw error;
      }
    } catch (err) {
      console.warn(`balance snapshot failed for item ${item.id}: ${describeError(err)}`);
    }

    // After the snapshot, for the same reasons: success is already latched and
    // the cursor has advanced, so a failed radar costs nothing but a log line.
    // Never in `finally` — the login_required and error paths have no new data,
    // and a throw there would escape syncItem.
    try {
      await refreshRecurring(admin, item, transferCategoryIds);
    } catch (err) {
      console.warn(`recurring refresh failed for item ${item.id}: ${describeError(err)}`);
    }
  } catch (err) {
    if ((err as Error).message !== HANDLED) {
      const message = describeError(err);
      console.error(`sync failed for item ${item.id}: ${message}`, err);
      result = { ...base, status: 'error', message };
    }
  } finally {
    // Always free the claim, including on a thrown error.
    await admin.from('plaid_items').update({ sync_locked_at: null }).eq('id', item.id);
  }

  return result;
}
