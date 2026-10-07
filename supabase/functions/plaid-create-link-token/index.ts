import { CountryCode, Products } from 'npm:plaid@30';

import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, getWebhookUrl, jsonResponse, loggable, requireSecondStep } from '../_shared/lib.ts';
import { plaidErrorFields, recordPlaidEvent } from '../_shared/plaid-log.ts';
import { canAddBank, historyDays, loadPlan, planLimitBody, type PlanState } from '../_shared/plans.ts';

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
  const blocked = await requireSecondStep(admin, req, user.id);
  if (blocked) return blocked;

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

  // A new bank must fit the plan (Phase 14). Reconnecting an existing bank
  // (update mode) is never a new bank, so it is never refused.
  let plan: PlanState | null = null;
  if (!accessToken) {
    try {
      plan = await loadPlan(admin, user.id);
    } catch (err) {
      // Unsure means no: never open Link on a plan we could not read.
      console.error('plan read failed', err);
      return jsonResponse({ error: 'Could not check your plan' }, 500);
    }
    if (!canAddBank(plan)) return jsonResponse(planLimitBody(plan), 402);
  }

  try {
    const plaid = getPlaidClient();
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Tusky',
      // Update mode: pass the existing access_token and OMIT products — Plaid
      // rejects products alongside access_token. The Item's token does not
      // change, so no /item/public_token/exchange follows this flow.
      ...(accessToken
        ? { access_token: accessToken }
        : {
          products: [Products.Transactions],
          // How far back the first pull reaches. Plaid's default is 90 days.
          transactions: { days_requested: historyDays(plan!) },
        }),
      country_codes: [CountryCode.Us],
      language: 'en',
      // New Items register for webhooks at birth; see plaid-webhook.
      webhook: getWebhookUrl(),
      // Required for the native Android Link SDK; must also be registered as an
      // Allowed Android package name in the Plaid dashboard (API settings).
      android_package_name: 'com.ouroborosstudios.tusky',
    });

    return jsonResponse({ link_token: data.link_token, expiration: data.expiration, update_mode: accessToken !== null });
  } catch (err) {
    console.error('linkTokenCreate failed', loggable(err));
    // body.item_id passed the ownership check above, or is absent.
    await recordPlaidEvent(admin, { event: 'link_token_failed', user_id: user.id, item_id: body.item_id ?? null, ...plaidErrorFields(err) });
    return jsonResponse({ error: 'Failed to create link token' }, 500);
  }
});
