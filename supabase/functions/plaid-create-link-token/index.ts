import { CountryCode, Products } from 'npm:plaid@30';

import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, getWebhookUrl, jsonResponse } from '../_shared/lib.ts';

/** Optional body. With item_id, Link opens in update mode to repair that Item. */
type LinkTokenBody = { item_id?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: LinkTokenBody = {};
  try {
    body = await req.json();
  } catch {
    // No body is the normal "connect a new bank" case.
  }

  let accessToken: string | null = null;
  if (body.item_id) {
    // Ownership check first — item_id comes from the client.
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
    if (tokenError || !tokenRow) {
      console.error('no access token for item', body.item_id, tokenError);
      return jsonResponse({ error: 'Could not start the reconnect' }, 500);
    }
    accessToken = tokenRow.access_token;
  }

  try {
    const plaid = getPlaidClient();
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Tusky',
      // Update mode: pass the existing access_token and OMIT products — Plaid
      // rejects products alongside access_token. The Item's token does not
      // change, so no /item/public_token/exchange follows this flow.
      ...(accessToken ? { access_token: accessToken } : { products: [Products.Transactions] }),
      country_codes: [CountryCode.Us],
      language: 'en',
      // New Items register for webhooks at birth; see plaid-webhook.
      webhook: getWebhookUrl(),
      // Required for the native Android Link SDK; must also be registered as an
      // Allowed Android package name in the Plaid dashboard (API settings).
      android_package_name: 'com.tusky.app',
    });

    return jsonResponse({ link_token: data.link_token, expiration: data.expiration, update_mode: accessToken !== null });
  } catch (err) {
    console.error('linkTokenCreate failed', err);
    return jsonResponse({ error: 'Failed to create link token' }, 500);
  }
});
