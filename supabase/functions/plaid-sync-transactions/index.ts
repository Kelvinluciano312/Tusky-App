import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { type CategoryMap, pickCategoryId, resolveCategoryId, toSignedAmount } from '../_shared/categorize.ts';

const PAGE_SIZE = 500;
const FIRST_SYNC_DAYS = 90;
const MAX_MUTATION_RETRIES = 3;
/** A claim older than this is treated as abandoned by a dead invocation. */
const STALE_CLAIM_MS = 5 * 60_000;

type ItemStatus = 'synced' | 'skipped' | 'login_required' | 'error';

type ItemResult = {
  item_id: string;
  status: ItemStatus;
  added: number;
  modified: number;
  removed: number;
  /** Plaid error_code or a short reason, so the client can say what broke. */
  message?: string;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const plaid = getPlaidClient();

  // Taxonomy, loaded once per invocation.
  const { data: mapRows, error: mapError } = await admin
    .from('plaid_category_map')
    .select('pfc_primary, category_id');
  if (mapError) {
    console.error('failed to load category map', mapError);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }
  const categoryMap: CategoryMap = Object.fromEntries(
    (mapRows ?? []).map((r) => [r.pfc_primary, r.category_id]),
  );

  const { data: fallback, error: fallbackError } = await admin
    .from('categories').select('id').eq('slug', 'uncategorized').single();
  if (fallbackError || !fallback) {
    console.error('uncategorized category missing', fallbackError);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }
  const fallbackId: string = fallback.id;

  const { data: items, error: itemsError } = await admin
    .from('plaid_items')
    .select('id, plaid_item_id, status')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (itemsError) {
    console.error('failed to load items', itemsError);
    return jsonResponse({ error: 'Could not load connected banks' }, 500);
  }

  const results: ItemResult[] = [];

  for (const item of items ?? []) {
    const base: ItemResult = { item_id: item.id, status: 'synced', added: 0, modified: 0, removed: 0 };

    // Claim the item: atomic, survives across HTTP calls, self-heals when stale.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: claimed } = await admin
      .from('plaid_items')
      .update({ sync_locked_at: new Date().toISOString() })
      .eq('id', item.id)
      .or(`sync_locked_at.is.null,sync_locked_at.lt.${staleBefore}`)
      .select('id, sync_cursor')
      .maybeSingle();

    if (!claimed) {
      results.push({ ...base, status: 'skipped' });
      continue;
    }

    try {
      const { data: tokenRow, error: tokenError } = await admin
        .from('plaid_tokens').select('access_token').eq('item_id', item.id).single();
      if (tokenError || !tokenRow) throw new Error('access token missing');

      const accessToken: string = tokenRow.access_token;
      const startCursor: string | null = claimed.sync_cursor;

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
            results.push({ ...base, status: 'login_required' });
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
              user_id: user.id,
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
      // window idempotently rather than skipping it.
      await admin.from('plaid_items').update({ sync_cursor: finalCursor }).eq('id', item.id);

      results.push({ ...base, added: added.length, modified: modified.length, removed: removed.length });
    } catch (err) {
      if ((err as Error).message !== HANDLED) {
        const message = describeError(err);
        console.error(`sync failed for item ${item.id}: ${message}`, err);
        results.push({ ...base, status: 'error', message });
      }
    } finally {
      // Always free the claim, including on a thrown error.
      await admin.from('plaid_items').update({ sync_locked_at: null }).eq('id', item.id);
    }
  }

  return jsonResponse({ results });
});
