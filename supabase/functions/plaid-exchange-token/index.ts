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
    const { data: item, error: itemError } = await admin
      .from('plaid_items')
      .insert({
        user_id: user.id,
        plaid_item_id: exchange.item_id,
        institution_id: body.institution_id ?? null,
        institution_name: body.institution_name ?? null,
      })
      .select('id')
      .single();
    if (itemError) throw itemError;

    // 3. Store the access token (service-role-only table)
    const { error: tokenError } = await admin
      .from('plaid_tokens')
      .insert({ item_id: item.id, access_token: exchange.access_token });
    if (tokenError) throw tokenError;

    // 4. Pull accounts for the new item
    const { data: accountsData } = await plaid.accountsGet({
      access_token: exchange.access_token,
    });

    const rows = accountsData.accounts.map((a) => ({
      user_id: user.id,
      item_id: item.id,
      plaid_account_id: a.account_id,
      name: a.name,
      official_name: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current_balance: a.balances.current,
      available_balance: a.balances.available,
      iso_currency_code: a.balances.iso_currency_code ?? 'USD',
    }));

    const { error: accountsError } = await admin
      .from('accounts')
      .upsert(rows, { onConflict: 'plaid_account_id' });
    if (accountsError) throw accountsError;

    return jsonResponse({ item_id: item.id, accounts: rows.length });
  } catch (err) {
    console.error('exchange-token failed', err);
    return jsonResponse({ error: 'Failed to connect bank' }, 500);
  }
});
