// DEV/TEST ONLY. Drives Plaid Sandbox so paths that normally wait on the real
// world can be exercised on demand:
//   reset_login  — forces ITEM_LOGIN_REQUIRED (the reconnect path). Plaid fires
//                  an ITEM ERROR webhook for it on its own.
//   fire_webhook — asks Plaid to send SYNC_UPDATES_AVAILABLE (the webhook path).
//
// Two guards: this refuses unless PLAID_ENV is sandbox, and the caller must own
// the Item. The app only surfaces it under __DEV__.

import { SandboxItemFireWebhookRequestWebhookCodeEnum } from 'npm:plaid@30';

import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, getWebhookUrl, jsonResponse } from '../_shared/lib.ts';

type Body = { item_id?: string; action?: 'reset_login' | 'fire_webhook' };

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
  if (body.action !== 'reset_login' && body.action !== 'fire_webhook') {
    return jsonResponse({ error: 'action must be reset_login or fire_webhook' }, 400);
  }

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
  const accessToken: string = tokenRow.access_token;

  try {
    const plaid = getPlaidClient();
    // Items linked before webhooks existed have no URL, and Plaid silently
    // sends nothing for them. Every Sandbox Item passes through here, so this
    // is where they get one; new Items get it on linkTokenCreate.
    await plaid.itemWebhookUpdate({ access_token: accessToken, webhook: getWebhookUrl() });

    if (body.action === 'reset_login') {
      await plaid.sandboxItemResetLogin({ access_token: accessToken });
      // Deliberately NOT setting status here: the ITEM ERROR webhook should,
      // and failing that the next sync discovers it — both are under test.
    } else {
      await plaid.sandboxItemFireWebhook({
        access_token: accessToken,
        webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.SyncUpdatesAvailable,
      });
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`sandbox ${body.action} failed`, err);
    return jsonResponse({ error: `${body.action} failed` }, 500);
  }
});
