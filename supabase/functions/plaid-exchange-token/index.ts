import { syncAccounts } from '../_shared/accounts.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

type ExchangeBody = {
  public_token: string;
  institution_id?: string;
  institution_name?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: ExchangeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.public_token) {
    return jsonResponse({ error: 'public_token is required' }, 400);
  }

  const plaid = getPlaidClient();

  try {
    // 1. Exchange the public token for a permanent access token
    const { data: exchange } = await plaid.itemPublicTokenExchange({
      public_token: body.public_token,
    });

    // 2. Record the item
    // Upsert, not insert: a reconnect can legitimately return an item_id we
    // already hold, and a plain insert would hard-fail on the unique constraint.
    const { data: item, error: itemError } = await admin
      .from('plaid_items')
      .upsert(
        {
          user_id: user.id,
          plaid_item_id: exchange.item_id,
          institution_id: body.institution_id ?? null,
          institution_name: body.institution_name ?? null,
          status: 'active',
        },
        { onConflict: 'plaid_item_id' },
      )
      .select('id')
      .single();
    if (itemError) throw itemError;

    // 3. Store the access token (service-role-only table)
    // Same reasoning: re-linking an existing Item replaces its token.
    const { error: tokenError } = await admin
      .from('plaid_tokens')
      .upsert({ item_id: item.id, access_token: exchange.access_token }, { onConflict: 'item_id' });
    if (tokenError) throw tokenError;

    // 4. Pull accounts for the new item. Shared with syncItem, which runs the
    //    same refresh on every sync so balances stop being frozen at link time.
    await syncAccounts(admin, plaid, exchange.access_token, user.id, item.id);

    return jsonResponse({ item_id: item.id });
  } catch (err) {
    console.error('exchange-token failed', err);
    return jsonResponse({ error: 'Failed to connect bank' }, 500);
  }
});
