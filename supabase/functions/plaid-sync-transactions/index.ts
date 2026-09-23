import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { type ItemResult, loadSyncContext, type SyncContext, syncItem } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let ctx: SyncContext;
  try {
    ctx = await loadSyncContext(admin, getPlaidClient());
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }

  // Include login_required: after Link update mode repairs an Item, a successful
  // sync is what returns it to active. Filtering to active only would strand a
  // repaired Item as permanently un-syncable.
  const { data: items, error: itemsError } = await admin
    .from('plaid_items')
    .select('id, user_id, status')
    .eq('user_id', user.id)
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
