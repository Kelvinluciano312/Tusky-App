// Create, change or remove the caller's herd's rule for one merchant: a category
// ("always categorize this merchant as X"), a display name, or both. When the
// category part changes, every non-manual transaction for that merchant is
// re-resolved with the same resolver sync uses, so removing a rule restores
// Plaid's category. JWT-verified by default: no config.toml entry.

import { corsHeaders, getAdminClient, getAuthedUser, getCallerHerd, jsonResponse } from '../_shared/lib.ts';
import { mergeRule, planReresolve, validateRuleInput } from '../_shared/rules.ts';
import { loadCategoryMaps } from '../_shared/sync.ts';

const CHUNK = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const input = validateRuleInput(body);
  if ('error' in input) return jsonResponse({ error: input.error }, 400);

  try {
    const { herd_id: herdId } = await getCallerHerd(admin, user.id);

    // The category must be one the caller can see: built-in, or their herd's.
    if (typeof input.category_id === 'string') {
      const { data: category, error } = await admin
        .from('categories')
        .select('id, herd_id')
        .eq('id', input.category_id)
        .maybeSingle();
      if (error) throw error;
      if (!category || (category.herd_id !== null && category.herd_id !== herdId)) {
        return jsonResponse({ error: 'Unknown category' }, 404);
      }
    }

    const { data: existing, error: existingError } = await admin
      .from('merchant_rules')
      .select('category_id, display_name')
      .eq('herd_id', herdId)
      .eq('merchant_key', input.merchant_key)
      .maybeSingle();
    if (existingError) throw existingError;

    const merged = mergeRule(existing, input);
    if (merged === null) {
      const { error } = await admin
        .from('merchant_rules')
        .delete()
        .eq('herd_id', herdId)
        .eq('merchant_key', input.merchant_key);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from('merchant_rules')
        .upsert({ herd_id: herdId, merchant_key: input.merchant_key, ...merged }, { onConflict: 'herd_id,merchant_key' });
      if (error) throw error;
    }

    const before = existing?.category_id ?? null;
    const after = merged?.category_id ?? null;
    let updated = 0;
    if (before !== after) {
      const { data: rows, error: rowsError } = await admin
        .from('transactions')
        .select('id, pfc_detailed, pfc_primary, category_id')
        .eq('herd_id', herdId)
        .eq('merchant_key', input.merchant_key)
        .eq('category_is_manual', false);
      if (rowsError) throw rowsError;

      const maps = await loadCategoryMaps(admin);
      const plan = planReresolve(
        rows ?? [],
        after,
        { detailed: maps.detailedMap, primary: maps.categoryMap },
        maps.fallbackId,
      );
      for (const { category_id, ids } of plan) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await admin
            .from('transactions')
            .update({ category_id })
            .in('id', ids.slice(i, i + CHUNK))
            // Re-checked at write time: a row set by hand meanwhile stays put.
            .eq('category_is_manual', false);
          if (error) throw error;
        }
        updated += ids.length;
      }
    }

    return jsonResponse({ ok: true, updated });
  } catch (err) {
    console.error(`set-merchant-rule failed for ${input.merchant_key}`, err);
    return jsonResponse({ error: 'Could not save the rule' }, 500);
  }
});
