// After a user categorizes a transaction by hand (Phase 12a), teach the rest
// of that merchant: the herd's non-manual rows that are still waiting for
// review are re-resolved with the same resolver sync uses, now that there is
// one more label. Rows already reviewed are left alone: the user has seen them.
// JWT-verified by default: no config.toml entry.

import { corsHeaders, getAdminClient, getAuthedUser, getCallerHerd, jsonResponse } from '../_shared/lib.ts';
import { planReresolve } from '../_shared/rules.ts';
import { loadCategoryMaps, loadLabels } from '../_shared/sync.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { transaction_id?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const id = body?.transaction_id;
  if (typeof id !== 'string' || !UUID.test(id)) return jsonResponse({ error: 'transaction_id is required' }, 400);

  try {
    const { herd_id: herdId } = await getCallerHerd(admin, user.id);

    const { data: fixed, error: fixedError } = await admin
      .from('transactions').select('merchant_key').eq('id', id).eq('herd_id', herdId).maybeSingle();
    if (fixedError) throw fixedError;
    if (!fixed) return jsonResponse({ error: 'Unknown transaction' }, 404);
    const merchantKey: string = fixed.merchant_key ?? '';
    // A name with no letters has an empty key: nothing to learn.
    if (!merchantKey) return jsonResponse({ ok: true, updated: 0 });

    const { data: rule, error: ruleError } = await admin
      .from('merchant_rules').select('category_id')
      .eq('herd_id', herdId).eq('merchant_key', merchantKey).maybeSingle();
    if (ruleError) throw ruleError;

    const { data: rows, error: rowsError } = await admin
      .from('transactions')
      .select('id, pfc_detailed, pfc_primary, category_id, category_source, amount, user_id, accounts!inner(is_private)')
      .eq('herd_id', herdId)
      .eq('merchant_key', merchantKey)
      .eq('category_is_manual', false)
      .is('reviewed_at', null);
    if (rowsError) throw rowsError;

    const maps = await loadCategoryMaps(admin);
    const labels = (await loadLabels(admin, herdId, [merchantKey])).get(merchantKey) ?? [];
    const plan = planReresolve(
      (rows ?? []).map(({ accounts, ...r }) => ({
        ...r,
        amount: Number(r.amount),
        is_private: (accounts as unknown as { is_private: boolean }).is_private,
      })),
      rule?.category_id ?? null,
      labels,
      { detailed: maps.detailedMap, primary: maps.categoryMap },
      maps.fallbackId,
    );

    let updated = 0;
    for (const { category_id, category_source, ids } of plan) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await admin
          .from('transactions')
          .update({ category_id, category_source })
          .in('id', ids.slice(i, i + CHUNK))
          // Re-checked at write time: set by hand or reviewed meanwhile, it stays put.
          .eq('category_is_manual', false)
          .is('reviewed_at', null);
        if (error) throw error;
      }
      updated += ids.length;
    }
    return jsonResponse({ ok: true, updated });
  } catch (err) {
    console.error(`apply-learning failed for ${id}`, err);
    return jsonResponse({ error: 'Could not apply what Tusky learned' }, 500);
  }
});
