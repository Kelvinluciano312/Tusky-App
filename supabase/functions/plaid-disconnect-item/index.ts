// Disconnect a bank: remove the Item at Plaid (which is what stops its
// billing), then either archive it — token gone, history kept — or delete
// everything. JWT-verified by default; the caller must own the Item.

import { type DisconnectMode, disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

type Body = { item_id?: unknown; mode?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the field checks
  }
  // Checked as a UUID up front: PostgREST would otherwise answer 22P02, a 500.
  if (typeof body.item_id !== 'string' || !UUID.test(body.item_id)) {
    return jsonResponse({ error: 'item_id is required' }, 400);
  }
  if (body.mode !== 'archive' && body.mode !== 'delete') {
    return jsonResponse({ error: 'mode must be archive or delete' }, 400);
  }
  const itemId = body.item_id;
  const mode: DisconnectMode = body.mode;

  try {
    const { data: item, error: itemError } = await admin
      .from('plaid_items')
      .select('id, status')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return jsonResponse({ error: 'Unknown bank connection' }, 404);

    const result = await disconnectItem(admin, getPlaidClient(), item, mode);
    if (result === 'busy') {
      return jsonResponse({ error: 'This bank is syncing — try again in a moment.' }, 409);
    }
    if (result === 'plaid_failed') {
      return jsonResponse({ error: "Plaid couldn't remove the connection; nothing was changed." }, 502);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`disconnect ${mode} failed for item ${itemId}`, err);
    return jsonResponse({ error: 'Could not disconnect the bank' }, 500);
  }
});
