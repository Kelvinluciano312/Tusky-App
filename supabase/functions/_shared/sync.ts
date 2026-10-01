import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { buildSnapshotRows, syncAccounts } from './accounts.ts';
import {
  AI_MAX_PER_SYNC,
  AI_UPDATE_CHUNK,
  type AiAnswer,
  type AiCategory,
  type AiLevel,
  type AiRow,
  type AiVerdict,
  applyAnswers,
  type AskFn,
  buildAskList,
  cacheKeyFor,
  groupUpdates,
  jevCategorizer,
} from './ai.ts';
import { type CategoryMap, pickCategory, resolveCategory, toSignedAmount } from './categorize.ts';
import { communityAnswers, communityCategory, crowdMerchants, type Tally } from './crowd.ts';
import { applyCustom, askCustom, type CatRow, type CustomRow, type CustomVerdict, planCustom } from './custom-ai.ts';
import { askJev, hasJevKey, JEV_CONCURRENCY, JEV_PASS_BUDGET_MS, type JevAsk, mapLimit } from './jev.ts';
import { type Label, LEARN, learnedCategory, usableLabels } from './learn.ts';
import { mergeReconnected } from './merge.ts';
import { aiAllowed, loadPlan } from './plans.ts';
import {
  ignoredCategoryIds,
  jevRecurringDecide,
  normalizeMerchant,
  type RecurringDecide,
  refreshRecurring,
} from './recurring.ts';
import { type CarriedPayer, carryForward, type ExistingRow } from './review.ts';
import { groupTriage, readTriage, TRIAGE_PER_SYNC, triageQuestions, type TriageRow, triageState } from './triage.ts';

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
 * Plaid code → category maps plus the fallback: everything resolveCategory
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

/** Merchant keys per labels query: keeps the PostgREST URL short. */
/**
 * Merchant keys per merchant_labels call. Each key returns at most
 * 2 × LEARN.RECENT rows (both directions), so 40 keys stay under PostgREST's
 * max_rows (1000), which would otherwise cut the answer silently.
 */
const LABEL_KEY_CHUNK = 40;

/**
 * The herd's labels (12a) for these merchants, keyed by merchant_key: rows
 * categorized by hand, and guesses accepted in review, the most recent
 * LEARN.RECENT per merchant and direction (the merchant_labels SQL function).
 * Shared by sync, set-merchant-rule and apply-learning, so all three learn
 * identically.
 */
export async function loadLabels(
  admin: SupabaseClient,
  herdId: string,
  merchantKeys: string[],
): Promise<Map<string, Label[]>> {
  const byMerchant = new Map<string, Label[]>();
  // A name with no letters has an empty key: it takes no rule, and teaches nothing.
  const keys = [...new Set(merchantKeys.filter(Boolean))];
  for (let i = 0; i < keys.length; i += LABEL_KEY_CHUNK) {
    const { data, error } = await admin.rpc('merchant_labels', {
      p_herd: herdId,
      p_keys: keys.slice(i, i + LABEL_KEY_CHUNK),
      p_limit: LEARN.RECENT,
    });
    if (error) throw new Error(`failed to load labels: ${error.message}`);
    for (const r of (data ?? []) as (Omit<Label, 'amount'> & { merchant_key: string; amount: number | string })[]) {
      const list = byMerchant.get(r.merchant_key) ?? [];
      list.push({
        amount: Number(r.amount),
        category_id: r.category_id,
        date: r.date,
        user_id: r.user_id,
        is_private: r.is_private,
      });
      byMerchant.set(r.merchant_key, list);
    }
  }
  return byMerchant;
}

/**
 * Merchants per community_tallies call. Each returns at most 12 bands
 * (6 bands × 2 directions) × the categories voted for, so 25 stays well under
 * PostgREST's max_rows (1000), which would otherwise cut the answer silently.
 */
const CROWD_MERCHANT_CHUNK = 25;

/**
 * The crowd's answers (12c) for these pool merchants, as crowdKey → category.
 * Never throws: the crowd is a bonus, and a sync is never worth failing over it.
 */
export async function loadCommunity(
  admin: SupabaseClient,
  merchants: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(merchants.filter(Boolean))];
  const tallies: Tally[] = [];
  try {
    for (let i = 0; i < unique.length; i += CROWD_MERCHANT_CHUNK) {
      const { data, error } = await admin.rpc('community_tallies', {
        p_merchants: unique.slice(i, i + CROWD_MERCHANT_CHUNK),
      });
      if (error) throw new Error(error.message);
      tallies.push(...((data ?? []) as Tally[]));
    }
  } catch (err) {
    console.warn(`crowd labels skipped: ${describeError(err)}`);
    return new Map();
  }
  return communityAnswers(tallies);
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
 * Whether Jev may decide anything for this Item (12d). It needs a key, a plan
 * that includes AI (14a: the connector's plan), and the connector's own switch:
 * one switch covers every surface, off by default. Checked once per sync.
 * Never throws: unsure means no.
 */
export async function jevEnabled(
  admin: SupabaseClient,
  item: { user_id: string; herd_id: string },
): Promise<boolean> {
  try {
    if (!hasJevKey()) return false;
    if (!aiAllowed(await loadPlan(admin, item.user_id))) return false;
    const { data, error } = await admin
      .from('profiles').select('ai_categorize').eq('user_id', item.user_id).maybeSingle();
    if (error) return false;
    return data?.ai_categorize === true;
  } catch {
    return false;
  }
}

/**
 * The AI fallback (12b; answered by Jev since 12d), run after the upsert over
 * the rows every other source was unsure about. The caller has already checked
 * jevEnabled. Never throws: a missed category is not worth failing a sync
 * over, and the next sync retries. `ask` is injected for tests.
 */
export async function runAiPass(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
  ask: AskFn = jevCategorizer(),
): Promise<number> {
  try {
    // Only this Item's rows, and only the ones nothing else could settle.
    const { data: rowData, error: rowError } = await admin
      .from('transactions')
      .select('id, merchant_key, name, merchant_name, amount, pfc_primary, pfc_detailed, accounts!inner(is_private)')
      .eq('item_id', item.id)
      .eq('category_is_manual', false)
      .in('category_source', ['plaid', 'fallback'])
      .or('pfc_confidence.is.null,pfc_confidence.in.(LOW,UNKNOWN)');
    if (rowError) throw rowError;
    const rows: AiRow[] = (rowData ?? []).map((r) => ({
      id: r.id,
      merchant_key: r.merchant_key ?? '',
      name: r.name,
      merchant_name: r.merchant_name,
      amount: Number(r.amount),
      pfc_primary: r.pfc_primary,
      pfc_detailed: r.pfc_detailed,
      is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
    }));
    if (rows.length === 0) return 0;

    const keys = [...new Set(rows.map(cacheKeyFor))];
    const { data: cacheRows } = await admin
      .from('ai_category_cache').select('cache_key, category_id, confidence, level').in('cache_key', keys);
    const cached = new Map<string, AiVerdict | null>(
      (cacheRows ?? []).map((c) => [
        c.cache_key as string,
        c.category_id
          ? {
            category_id: c.category_id as string,
            confidence: c.confidence === null || c.confidence === undefined ? null : Number(c.confidence),
            level: (c.level as AiLevel | null) ?? null,
          }
          : null,
      ]),
    );

    // Every built-in, groups included: since 12d a sure group is an answer too.
    const { data: categoryRows } = await admin
      .from('categories').select('id, slug, name, parent_id').is('herd_id', null);
    const slugById = new Map((categoryRows ?? []).map((c) => [c.id as string, c.slug as string | null]));
    const categories: AiCategory[] = (categoryRows ?? []).flatMap((c): AiCategory[] => {
      if (!c.slug) return [];
      const base = { id: c.id as string, slug: c.slug as string, name: c.name as string };
      if (c.parent_id === null) return [{ ...base, parent_slug: null }];
      const parent = slugById.get(c.parent_id as string);
      // A child whose group has no slug cannot be placed in the fan-out.
      return parent ? [{ ...base, parent_slug: parent }] : [];
    });

    const { ask: toAsk, resolved } = buildAskList(rows, cached);
    const sent = toAsk.slice(0, AI_MAX_PER_SYNC);
    let answers: AiAnswer[] = [];
    if (sent.length > 0) answers = await ask(sent, categories);
    // Only the keys Jev actually answered, with a category or an explicit
    // decline. A key whose call failed is neither written nor remembered, so
    // the next sync asks again.
    const sentKeys = new Set(sent.map(cacheKeyFor));
    const answered = [...new Set(answers.map((a) => a.key))].filter((k) => sentKeys.has(k));
    const { updates, cacheable, unanswered } = applyAnswers(rows, answers, categories, answered);

    // Cache hits update rows too, and cost nothing.
    for (const [id, verdict] of resolved) updates.push({ id, ...verdict });

    // Grouped and chunked: a warm cache can answer hundreds of rows at once, and
    // one statement per row would add seconds to every sync.
    for (const group of groupUpdates(updates)) {
      const { error } = await admin
        .from('transactions')
        .update({
          category_id: group.verdict.category_id,
          category_source: 'ai',
          ai_confidence: group.verdict.confidence,
          ai_level: group.verdict.level,
        })
        .in('id', group.ids)
        // Re-checked at write time: a row set by hand meanwhile stays put.
        .eq('category_is_manual', false);
      if (error) throw error;
    }
    const entries = [
      ...cacheable.map((c) => ({
        cache_key: c.key,
        category_id: c.category_id as string | null,
        confidence: c.confidence,
        level: c.level,
      })),
      // Asked and declined: remembered so no later sync pays to ask again.
      ...unanswered.map((key) => ({ cache_key: key, category_id: null, confidence: null, level: null })),
    ];
    if (entries.length > 0) {
      await admin.from('ai_category_cache').upsert(entries, { onConflict: 'cache_key' });
    }
    return updates.length;
  } catch (err) {
    console.warn(`ai pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
}

/**
 * The herd's own categories (15h): after runAiPass, unreviewed rows sitting in
 * a built-in group that the herd has custom children under get one more
 * question, between those and keeping what they have. Cached per herd
 * (ai_custom_cache), never globally. Never throws.
 */
export async function runCustomPass(
  admin: SupabaseClient,
  item: { id: string; herd_id: string },
  ask: JevAsk = askJev,
): Promise<number> {
  try {
    const { data: catData, error: catError } = await admin
      .from('categories')
      .select('id, name, parent_id, herd_id')
      .or(`herd_id.is.null,herd_id.eq.${item.herd_id}`);
    if (catError) throw catError;
    const categories = (catData ?? []) as CatRow[];
    if (!categories.some((c) => c.herd_id === item.herd_id && c.parent_id !== null)) return 0;

    const { data: rowData, error: rowError } = await admin
      .from('transactions')
      .select('id, merchant_key, name, merchant_name, amount, pfc_primary, pfc_detailed, category_id, accounts!inner(is_private)')
      .eq('item_id', item.id)
      .eq('category_is_manual', false)
      .in('category_source', ['ai', 'plaid', 'fallback'])
      .is('reviewed_at', null)
      .not('category_id', 'is', null);
    if (rowError) throw rowError;
    const rows: CustomRow[] = (rowData ?? []).map((r) => ({
      id: r.id,
      merchant_key: r.merchant_key ?? '',
      name: r.name,
      merchant_name: r.merchant_name,
      amount: Number(r.amount),
      pfc_primary: r.pfc_primary,
      pfc_detailed: r.pfc_detailed,
      is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
      category_id: r.category_id as string,
    }));
    const plans = planCustom(rows, categories, item.herd_id);
    if (plans.length === 0) return 0;

    const keys = [...new Set(plans.map((p) => p.key))];
    const cached = new Map<string, CustomVerdict>();
    for (let i = 0; i < keys.length; i += AI_UPDATE_CHUNK) {
      const { data } = await admin
        .from('ai_custom_cache')
        .select('cache_key, category_id, confidence')
        .eq('herd_id', item.herd_id)
        .in('cache_key', keys.slice(i, i + AI_UPDATE_CHUNK));
      for (const c of data ?? []) {
        cached.set(c.cache_key as string, {
          category_id: (c.category_id as string | null) ?? null,
          confidence: c.confidence === null ? null : Number(c.confidence),
        });
      }
    }

    const fresh = await askCustom(plans.filter((p) => !cached.has(p.key)), ask);
    const { updates, cacheable } = applyCustom(plans, cached, fresh);

    for (const group of groupUpdates(updates.map((u) => ({ id: u.id, category_id: u.category_id, confidence: u.confidence, level: 'child' as const })))) {
      const { error } = await admin
        .from('transactions')
        .update({
          category_id: group.verdict.category_id,
          category_source: 'ai',
          ai_confidence: group.verdict.confidence,
          ai_level: 'child',
        })
        .in('id', group.ids)
        // Re-checked at write time: a row set by hand or reviewed meanwhile stays put.
        .eq('category_is_manual', false)
        .is('reviewed_at', null);
      if (error) throw error;
    }
    if (cacheable.length > 0) {
      await admin.from('ai_custom_cache').upsert(
        cacheable.map((c) => ({ herd_id: item.herd_id, cache_key: c.key, category_id: c.category_id, confidence: c.confidence })),
        { onConflict: 'herd_id,cache_key' },
      );
    }
    return updates.length;
  } catch (err) {
    console.warn(`custom ai pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
}

/**
 * Triage (12d): a review priority for each unreviewed posted row and, in a
 * shared herd, a split hint. Runs after runAiPass so it sees the final
 * categories. Only rows no triage has reached, newest first, TRIAGE_PER_SYNC
 * at a time. A row whose call failed stays unjudged and is retried next sync.
 * The caller has already checked jevEnabled. Never throws.
 */
export async function runTriagePass(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
  ask: JevAsk = askJev,
): Promise<number> {
  try {
    const { data: rowData, error: rowError } = await admin
      .from('transactions')
      .select('id, name, merchant_name, amount, category_id, category_source, split, accounts!inner(is_private)')
      .eq('item_id', item.id)
      .eq('pending', false)
      .is('reviewed_at', null)
      .is('review_priority', null)
      .order('date', { ascending: false })
      .limit(TRIAGE_PER_SYNC);
    if (rowError) throw rowError;
    if (!rowData || rowData.length === 0) return 0;

    const { data: memberRows, error: memberError } = await admin
      .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
    if (memberError) throw memberError;
    const herdSize = (memberRows ?? []).length;
    // isShared's rule (apps/mobile/src/lib/herd.ts): a herd of one has nobody to share with.
    const shared = herdSize > 1;

    const categoryIds = [...new Set(rowData.map((r) => r.category_id as string | null).filter(Boolean))];
    let nameOf = new Map<string, string>();
    if (categoryIds.length > 0) {
      const { data: categoryRows, error: categoryError } = await admin
        .from('categories').select('id, name').in('id', categoryIds);
      if (categoryError) throw categoryError;
      nameOf = new Map((categoryRows ?? []).map((c) => [c.id as string, c.name as string]));
    }

    const rows: TriageRow[] = rowData.map((r) => ({
      id: r.id,
      name: r.name,
      merchant_name: r.merchant_name,
      amount: Number(r.amount),
      category_name: r.category_id ? nameOf.get(r.category_id) ?? null : null,
      category_source: r.category_source,
      is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
      split: r.split,
    }));

    const deadline = Date.now() + JEV_PASS_BUDGET_MS;
    const settled = await mapLimit(rows, JEV_CONCURRENCY, async (row) =>
      readTriage(row, await ask(triageState(row, herdSize), triageQuestions(row, shared), { deadline }), shared), deadline);
    const results = settled.flatMap((s) => (s.status === 'fulfilled' && s.value ? [s.value] : []));
    if (results.length === 0) {
      const failed = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) throw failed.reason;
      return 0;
    }

    let written = 0;
    for (const group of groupTriage(results)) {
      const { error } = await admin
        .from('transactions')
        .update({ review_priority: group.review_priority, split_suggested: group.split_suggested })
        .in('id', group.ids)
        // Re-checked at write time: a row reviewed meanwhile needs no priority.
        .is('reviewed_at', null);
      if (error) throw error;
      written += group.ids.length;
    }
    return written;
  } catch (err) {
    console.warn(`triage pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
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
      .from('accounts').select('id, plaid_account_id, is_private').eq('item_id', item.id);
    const accountByPlaidId = new Map<string, string>(
      (accountRows ?? []).map((a) => [a.plaid_account_id, a.id]),
    );
    // Which private labels may teach a row depends on its account (12a).
    const privateByPlaidId = new Map<string, boolean>(
      (accountRows ?? []).map((a) => [a.plaid_account_id, a.is_private === true]),
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
            // resolveCategory's uncategorized fallback is what protects us
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

      // The herd's own fixes (12a) for the merchants in this batch.
      // deno-lint-ignore no-explicit-any
      const merchantKeyOf = (t: any) => normalizeMerchant(t.merchant_name ?? t.name);
      const labelsByMerchant = await loadLabels(admin, item.herd_id, upserts.map(merchantKeyOf));

      // What the crowd agrees on (12c) for the merchants in this batch.
      const communityByKey = await loadCommunity(
        admin,
        upserts.flatMap((t) => crowdMerchants(t.merchant_entity_id, merchantKeyOf(t))),
      );

      // Read existing rows, and the pending rows these post from, so a manual
      // category or memo survives re-sync and pending → posted (carryForward).
      const ids = [...new Set(upserts.flatMap((t) =>
        t.pending_transaction_id ? [t.transaction_id, t.pending_transaction_id] : [t.transaction_id]
      ))];
      const { data: existingRows } = await admin
        .from('transactions')
        .select('plaid_transaction_id, category_id, category_is_manual, notes, paid_by, paid_by_is_manual, split, corrected_from, category_source')
        .in('plaid_transaction_id', ids);
      const { existingFor, notes: carriedNotes, payers: carriedPayers } = carryForward(
        upserts,
        new Map(((existingRows ?? []) as ExistingRow[]).map((r) => [r.plaid_transaction_id, r])),
      );

      const rows = upserts
        .filter((t) => accountByPlaidId.has(t.account_id))
        .map((t) => {
          const existing = existingFor.get(t.transaction_id) ?? null;
          const merchantKey = merchantKeyOf(t);
          const category = pickCategory(existing, resolveCategory(
            {
              rule: ruleByMerchant.get(merchantKey),
              // Only labels this row may learn from (private accounts).
              learned: learnedCategory(
                usableLabels(
                  labelsByMerchant.get(merchantKey) ?? [],
                  item.user_id,
                  privateByPlaidId.get(t.account_id) ?? false,
                ),
                toSignedAmount(t.amount),
              ),
              // The crowd (12c). An answer it already gave this row stands, like an AI one.
              community: existing?.category_source === 'community'
                ? existing.category_id
                : communityCategory(communityByKey, t.merchant_entity_id, merchantKey, toSignedAmount(t.amount)),
              // An answer the AI pass gave survives Plaid modifying the row.
              ai: existing?.category_source === 'ai' ? existing.category_id : null,
              detailed: t.personal_finance_category?.detailed,
              primary: t.personal_finance_category?.primary,
            },
            { detailed: detailedMap, primary: categoryMap },
            fallbackId,
          ));
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
            category_id: category.categoryId,
            // Every row carries it: a bulk upsert sends the union of the rows' keys.
            category_source: category.source,
            // A fix made while pending still counts once posted (cat-quality.mjs).
            corrected_from: existing?.corrected_from ?? null,
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
      // carried, and neither is a split (11b) naming one: the payer and split
      // triggers would refuse it and fail the whole sync.
      let members = new Set<string>();
      if (carriedPayers.length > 0) {
        const { data: memberRows, error: memberError } = await admin
          .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
        if (memberError) throw memberError;
        members = new Set((memberRows ?? []).map((m) => m.user_id as string));
      }
      const stillMembers = (p: CarriedPayer) =>
        (p.paid_by === null || members.has(p.paid_by)) &&
        (p.split === null || Object.keys(p.split).every((id) => members.has(id)));
      for (const p of carriedPayers.filter(stillMembers)) {
        const { error } = await admin
          .from('transactions').update({ paid_by: p.paid_by, paid_by_is_manual: true, split: p.split })
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

    // 14b: a reconnected bank takes over its kept history. After the cursor and
    // `result`, like the snapshot: a failed merge must not fail a good sync, and
    // it runs again next sync, since Plaid delivers history in stages.
    try {
      const replaced = await mergeReconnected(admin, item);
      if (replaced > 0) console.log(`item ${item.id}: merged ${replaced} kept rows into the reconnected bank`);
    } catch (err) {
      console.warn(`reconnect merge failed for item ${item.id}: ${describeError(err)}`);
    }

    // 12b/12d: Jev's decisions. After the cursor and after `result` is latched,
    // for the same two reasons the snapshot below is: it calls a third party,
    // and a slow or dead vendor must not cost a full re-pagination next sync or
    // turn a good sync into an error. The gate is read once. Never throws.
    const jevOn = await jevEnabled(admin, item);
    if (jevOn) {
      const aiSet = await runAiPass(admin, item);
      if (aiSet > 0) console.log(`item ${item.id}: AI categorized ${aiSet}`);
      // Then the herd's own categories (15h), over what the global pass settled.
      const customSet = await runCustomPass(admin, item);
      if (customSet > 0) console.log(`item ${item.id}: AI placed ${customSet} in custom categories`);
      // After the categories settle, so triage judges the final ones.
      const triaged = await runTriagePass(admin, item);
      if (triaged > 0) console.log(`item ${item.id}: triaged ${triaged}`);
    }

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
      // 12d: Jev breaks ties on near misses only when this sync's gate is open.
      let decide: RecurringDecide | undefined;
      if (jevOn) {
        const { data: names, error: namesError } = await admin
          .from('categories').select('id, name').or(`herd_id.is.null,herd_id.eq.${item.herd_id}`);
        if (namesError) throw namesError;
        decide = jevRecurringDecide(askJev, new Map((names ?? []).map((c) => [c.id as string, c.name as string])));
      }
      await refreshRecurring(
        admin,
        item,
        [...transferCategoryIds, ...ignoredCategoryIds(ownTransfers ?? [])],
        decide,
      );
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
