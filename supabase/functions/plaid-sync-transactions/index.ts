import { corsHeaders, getAdminClient, getAuthedUser, getCallerHerd, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { type ItemResult, loadSyncContext, type SyncContext, syncItem } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let herdId: string;
  let ctx: SyncContext;
  try {
    ({ herd_id: herdId } = await getCallerHerd(admin, user.id));
    ctx = await loadSyncContext(admin, getPlaidClient());
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }

  // Every live bank in the caller's herd, whoever connected it: syncing is free
  // (Plaid bills per Item, not per pull) and the whole herd sees the result.
  // Include login_required: after Link update mode repairs an Item, a successful
  // sync is what returns it to active. Filtering to active only would strand a
  // repaired Item as permanently un-syncable.
  const { data: items, error: itemsError } = await admin
    .from('plaid_items')
    .select('id, user_id, herd_id, status')
    .eq('herd_id', herdId)
    .in('status', ['active', 'login_required']);
  if (itemsError) {
    console.error('failed to load items', itemsError);
    return jsonResponse({ error: 'Could not load connected banks' }, 500);
  }

  const results: ItemResult[] = [];
  for (const item of items ?? []) {
    results.push(await syncItem(ctx, item));
  }

  return jsonResponse({ results });
});
