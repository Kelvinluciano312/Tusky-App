// Delete one of the caller's custom categories. Its transactions (manual flags
// kept) and recurring streams move to its group, its budget goes, and the row
// goes last, so a failure part-way leaves a state a retry finishes.
// JWT-verified by default: no config.toml entry.

import { planCategoryDelete, readCategoryId } from '../_shared/categories.ts';
import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the field check
  }
  const categoryId = readCategoryId(body);
  if (!categoryId) return jsonResponse({ error: 'category_id is required' }, 400);

  try {
    const { data: row, error: rowError } = await admin
      .from('categories')
      .select('id, parent_id, user_id')
      .eq('id', categoryId)
      .maybeSingle();
    if (rowError) throw rowError;
    const plan = planCategoryDelete(row, user.id);
    if (!plan) return jsonResponse({ error: 'Unknown category' }, 404);

    const { count: moved, error: txError } = await admin
      .from('transactions')
      .update({ category_id: plan.moveTo }, { count: 'exact' })
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (txError) throw txError;

    // Derived, and refreshed by the next sync; moved now so the delete below
    // never trips their foreign key.
    const { error: streamError } = await admin
      .from('recurring_streams')
      .update({ category_id: plan.moveTo })
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (streamError) throw streamError;

    // Rules follow the category to its group. merchant_rules.category_id has no
    // cascade, so if this step were ever skipped the delete below would fail.
    const { error: ruleError } = await admin
      .from('merchant_rules')
      .update({ category_id: plan.moveTo })
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (ruleError) throw ruleError;

    const { error: budgetError } = await admin
      .from('budgets')
      .delete()
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (budgetError) throw budgetError;

    const { error: deleteError } = await admin
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('user_id', user.id);
    if (deleteError) throw deleteError;

    return jsonResponse({ ok: true, moved: moved ?? 0 });
  } catch (err) {
    console.error(`delete-category failed for ${categoryId}`, err);
    return jsonResponse({ error: 'Could not delete the category' }, 500);
  }
});
