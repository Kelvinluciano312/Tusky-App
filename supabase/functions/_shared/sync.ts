import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { buildSnapshotRows, syncAccounts } from './accounts.ts';
import { type CategoryMap, pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';
import { ignoredCategoryIds, normalizeMerchant, refreshRecurring } from './recurring.ts';
import { carryForward, type ExistingRow } from './review.ts';

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
  detailedMap: CategoryMap;
  fallbackId: string;
  /** Built-in categories recurring detection ignores (transfers, except card payments); syncItem adds the owner's custom transfers. */
  transferCategoryIds: string[];
};

/** Plaid SDK errors carry the useful detail on response.data. */
export function describeError(err: unknown): string {
  const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
    ?.response?.data;
  if (data?.error_code) return `${data.error_code}: ${data.error_message ?? ''}`.trim();
  return (err as Error)?.message ?? 'unknown error';
}

/** Marker so an already-recorded failure isn't recorded twice by the catch. */
const HANDLED = '__handled__';

/**
 * Plaid code → category maps plus the fallback: everything resolveCategoryId
 * needs. Shared by sync and set-merchant-rule, so both resolve identically.
 */
export async function loadCategoryMaps(
  admin: SupabaseClient,
): Promise<{ categoryMap: CategoryMap; detailedMap: CategoryMap; fallbackId: string }> {
  const { data: mapRows, error: mapError } = await admin
    .from('plaid_category_map')
    .select('pfc_primary, category_id');
  if (mapError) throw new Error(`failed to load category map: ${mapError.message}`);
  const categoryMap: CategoryMap = Object.fromEntries(
    (mapRows ?? []).map((r) => [r.pfc_primary, r.category_id]),
  );

  const { data: detailedRows, error: detailedError } = await admin
    .from('plaid_detailed_map')
    .select('pfc_detailed, category_id');
  if (detailedError) throw new Error(`failed to load detailed map: ${detailedError.message}`);
  const detailedMap: CategoryMap = Object.fromEntries(
    (detailedRows ?? []).map((r) => [r.pfc_detailed, r.category_id]),
  );

  const { data: fallback, error: fallbackError } = await admin
    .from('categories').select('id').eq('slug', 'uncategorized').single();
  if (fallbackError || !fallback) {
    throw new Error(`uncategorized category missing: ${fallbackError?.message ?? 'no row'}`);
  }
  return { categoryMap, detailedMap, fallbackId: fallback.id };
}

/** Loads the taxonomy once per invocation. Throws if it cannot. */
export async function loadSyncContext(admin: SupabaseClient, plaid: PlaidApi): Promise<SyncContext> {
  const { categoryMap, detailedMap, fallbackId } = await loadCategoryMaps(admin);

  const { data: categoryRows, error: categoryError } = await admin
    .from('categories').select('id, kind, slug').is('herd_id', null);
  if (categoryError) throw new Error(`failed to load categories: ${categoryError.message}`);

  return {
    admin,
    plaid,
    categoryMap,
    detailedMap,
    fallbackId,
    transferCategoryIds: ignoredCategoryIds(categoryRows ?? []),
  };
}

/**
 * Claim an Item for exclusive work — a sync or a disconnect. Atomic, survives
 * across HTTP calls, and self-heals when stale. Only a live Item can be
 * claimed, whatever list the caller loaded: a sync that finished after an
 * archive would otherwise write rows and set status back to 'active'.
 */
export async function claimItem(
  admin: SupabaseClient,
  itemId: string,
): Promise<{ id: string; sync_cursor: string | null } | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data } = await admin
    .from('plaid_items')
    .update({ sync_locked_at: new Date().toISOString() })
    .eq('id', itemId)
    .in('status', ['active', 'login_required'])
    .or(`sync_locked_at.is.null,sync_locked_at.lt.${staleBefore}`)
    .select('id, sync_cursor')
    .maybeSingle();
  return data;
}

/**
 * Sync one Item. Shared by the user-triggered sync and the Plaid webhook, so
 * both paths claim, retry, preserve manual categories and advance the cursor
 * the same way. Never throws: failures come back as an ItemResult.
 */
export async function syncItem(
  ctx: SyncContext,
  item: { id: string; user_id: string; herd_id: string },
): Promise<ItemResult> {
  const { admin, plaid, categoryMap, detailedMap, fallbackId, transferCategoryIds } = ctx;
  const base: ItemResult = { item_id: item.id, status: 'synced', added: 0, modified: 0, removed: 0 };
  let result: ItemResult = base;

  const claimed = await claimItem(admin, item.id);
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
      // The herd's merchant rules outrank Plaid (a manual choice still wins,
      // in pickCategoryId). Keyed like transactions.merchant_key.
      const { data: ruleRows, error: ruleError } = await admin
        .from('merchant_rules')
        .select('merchant_key, category_id')
        .eq('herd_id', item.herd_id)
        .not('category_id', 'is', null);
      if (ruleError) throw ruleError;
      const ruleByMerchant = new Map((ruleRows ?? []).map((r) => [r.merchant_key, r.category_id as string]));

      // Read existing rows, and the pending rows these post from, so a manual
      // category or memo survives re-sync and pending → posted (carryForward).
      const ids = [...new Set(upserts.flatMap((t) =>
        t.pending_transaction_id ? [t.transaction_id, t.pending_transaction_id] : [t.transaction_id]
      ))];
      const { data: existingRows } = await admin
        .from('transactions')
        .select('plaid_transaction_id, category_id, category_is_manual, notes, paid_by, paid_by_is_manual')
        .in('plaid_transaction_id', ids);
      const { existingFor, notes: carriedNotes, payers: carriedPayers } = carryForward(
        upserts,
        new Map(((existingRows ?? []) as ExistingRow[]).map((r) => [r.plaid_transaction_id, r])),
      );

      const rows = upserts
        .filter((t) => accountByPlaidId.has(t.account_id))
        .map((t) => {
          const incoming = resolveCategoryId(
            {
              rule: ruleByMerchant.get(normalizeMerchant(t.merchant_name ?? t.name)),
              detailed: t.personal_finance_category?.detailed,
              primary: t.personal_finance_category?.primary,
            },
            { detailed: detailedMap, primary: categoryMap },
            fallbackId,
          );
          const existing = existingFor.get(t.transaction_id) ?? null;
          return {
            user_id: item.user_id,
            account_id: accountByPlaidId.get(t.account_id)!,
            item_id: item.id,
            plaid_transaction_id: t.transaction_id,
            name: t.name,
            merchant_name: t.merchant_name ?? null,
            merchant_entity_id: t.merchant_entity_id ?? null,
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
      // One small update per carried memo, and never over a memo already there.
      for (const c of carriedNotes) {
        const { error } = await admin
          .from('transactions').update({ notes: c.notes })
          .eq('plaid_transaction_id', c.plaid_transaction_id).is('notes', null);
        if (error) throw error;
      }
      // Who paid (9d): the database gave each new row its account's owner; a
      // payer picked by hand on the pending row replaces it, never over one
      // already picked on the posted row. A payer who has left the herd is not
      // carried: the payer trigger would refuse it and fail the whole sync.
      let members = new Set<string>();
      if (carriedPayers.length > 0) {
        const { data: memberRows, error: memberError } = await admin
          .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
        if (memberError) throw memberError;
        members = new Set((memberRows ?? []).map((m) => m.user_id as string));
      }
      for (const p of carriedPayers.filter((p) => p.paid_by === null || members.has(p.paid_by))) {
        const { error } = await admin
          .from('transactions').update({ paid_by: p.paid_by, paid_by_is_manual: true })
          .eq('plaid_transaction_id', p.plaid_transaction_id).eq('paid_by_is_manual', false);
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
    // clears a stale login_required — proof the credentials work again. Never
    // an archived Item's: a sync that outlived the stale window must not
    // un-archive a bank disconnected meanwhile.
    await admin
      .from('plaid_items')
      .update({ sync_cursor: finalCursor, status: 'active' })
      .eq('id', item.id)
      .in('status', ['active', 'login_required']);

    result = { ...base, added: added.length, modified: modified.length, removed: removed.length };

    // Last, and after `result` is latched: a failed chart row must not turn a
    // good sync into `status: 'error'`, nor cost a full re-pagination by landing
    // before the cursor advance. Not in `finally` either — that runs on the
    // login_required and error paths too, and a throw there would escape
    // syncItem, breaking the never-throws contract the webhook relies on.
    //
    // Every account of the HERD, not just this Item's: otherwise a day where one
    // Item synced and another did not would sum to a partial net worth and the
    // chart would sawtooth. An Item stuck on login_required keeps contributing
    // its last known balance, which is a deliberate carry-forward — stale, but
    // the alternative is the sawtooth. Settings' Reconnect prompt is the fix.
    // An archived bank is different — disconnected, not stale — and
    // buildSnapshotRows skips it.
    try {
      const { data: allAccounts } = await admin
        .from('accounts').select('id, user_id, current_balance, plaid_items(status)').eq('herd_id', item.herd_id);
      const snapshots = buildSnapshotRows(
        (allAccounts ?? []).map((a) => ({
          id: a.id,
          user_id: a.user_id,
          current_balance: a.current_balance,
          archived: (a.plaid_items as { status?: string } | null)?.status === 'archived',
        })),
      );
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
      // The herd's custom transfer categories join the built-in ones. Loaded
      // per Item, so the shared context never holds every herd's rows.
      const { data: ownTransfers, error: ownError } = await admin
        .from('categories')
        .select('id, kind, slug')
        .eq('herd_id', item.herd_id)
        .eq('kind', 'transfer');
      if (ownError) throw ownError;
      await refreshRecurring(admin, item, [...transferCategoryIds, ...ignoredCategoryIds(ownTransfers ?? [])]);
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
