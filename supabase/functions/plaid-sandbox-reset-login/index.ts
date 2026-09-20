// DEV/TEST ONLY. Forces Plaid to put an Item into ITEM_LOGIN_REQUIRED so the
// reconnect path (Link update mode) can be exercised deterministically instead
// of waiting for credentials to go stale on their own.
//
// Two guards: this refuses unless PLAID_ENV is sandbox, and the caller must own
// the Item. The app only surfaces it under __DEV__.

import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

type Body = { item_id?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Guard 1: never outside Sandbox.
  const env = Deno.env.get('PLAID_ENV') ?? 'sandbox';
  if (env !== 'sandbox') {
    return jsonResponse({ error: 'Only available in Plaid Sandbox' }, 403);
  }

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the missing-field check
  }
  if (!body.item_id) return jsonResponse({ error: 'item_id is required' }, 400);

  // Guard 2: the Item must belong to the caller.
  const { data: item } = await admin
    .from('plaid_items')
    .select('id')
    .eq('id', body.item_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return jsonResponse({ error: 'Unknown bank connection' }, 404);

  const { data: tokenRow, error: tokenError } = await admin
    .from('plaid_tokens')
    .select('access_token')
    .eq('item_id', body.item_id)
    .single();
  if (tokenError || !tokenRow) return jsonResponse({ error: 'No access token for that item' }, 500);

  try {
    const plaid = getPlaidClient();
    await plaid.sandboxItemResetLogin({ access_token: tokenRow.access_token });
    // Deliberately NOT setting status here: the next sync should discover
    // ITEM_LOGIN_REQUIRED on its own, which is the behaviour under test.
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('sandbox reset_login failed', err);
    return jsonResponse({ error: 'Reset failed' }, 500);
  }
});
