// Plaid → us. The project's only PUBLIC function: `verify_jwt = false` in
// config.toml, because Plaid holds no Supabase JWT. verifyPlaidWebhook is its
// authentication — nothing below it runs for a request that fails it.

import { getAdminClient, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { loadSyncContext, syncItem } from '../_shared/sync.ts';
import { classifyWebhook, type PlaidJwk, type PlaidWebhookBody, verifyPlaidWebhook } from '../_shared/webhook.ts';

/** Supabase Edge Runtime global: keeps the worker alive for work after the response. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const plaid = getPlaidClient();

/** Verification keys by kid, for the life of this instance. */
const keyCache = new Map<string, PlaidJwk>();

async function getKey(kid: string): Promise<PlaidJwk | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  try {
    const { data } = await plaid.webhookVerificationKeyGet({ key_id: kid });
    const key = data.key as PlaidJwk;
    keyCache.set(kid, key);
    return key;
  } catch (err) {
    console.error(`webhook key ${kid} could not be fetched`, err);
    return null;
  }
}

const ok = () => jsonResponse({ ok: true });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // Read the body once, as text: the signature covers these exact bytes.
  const rawBody = await req.text();
  if (!(await verifyPlaidWebhook(rawBody, req.headers.get('Plaid-Verification'), getKey))) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 401);
  }

  // Authentic from here on. Plaid retries any non-200 for 24h, so everything we
  // handle or choose to ignore gets 200; only our own database failing gets a
  // 500, which is exactly when a retry helps.
  const body = JSON.parse(rawBody) as PlaidWebhookBody;
  const tag = `webhook ${body.webhook_type}/${body.webhook_code} plaid_item=${body.item_id}`;

  const env = Deno.env.get('PLAID_ENV') ?? 'sandbox';
  if (body.environment !== env) {
    console.warn(`${tag}: from ${body.environment}, we are ${env} — ignored`);
    return ok();
  }

  const action = classifyWebhook(body);
  if (action === 'ignore') {
    console.log(`${tag}: ignored`);
    return ok();
  }

  const admin = getAdminClient();
  const { data: item, error: itemError } = await admin
    .from('plaid_items')
    .select('id, user_id')
    .eq('plaid_item_id', body.item_id)
    .in('status', ['active', 'login_required'])
    .maybeSingle();
  if (itemError) {
    console.error(`${tag}: item lookup failed`, itemError);
    return jsonResponse({ error: 'Item lookup failed' }, 500);
  }
  if (!item) {
    console.log(`${tag}: no syncable item — ignored`);
    return ok();
  }

  if (action === 'login_required') {
    const { error } = await admin.from('plaid_items').update({ status: 'login_required' }).eq('id', item.id);
    if (error) {
      console.error(`${tag}: could not mark item ${item.id}`, error);
      return jsonResponse({ error: 'Update failed' }, 500);
    }
    console.log(`${tag}: item ${item.id} → login_required`);
    return ok();
  }

  // Reply now, sync after: Plaid abandons a delivery after 10s, and a 90-day
  // first sync can take longer. A sync that fails here is healed by the next
  // webhook or pull-to-refresh — the cursor makes a re-run idempotent.
  EdgeRuntime.waitUntil(
    (async () => {
      const result = await syncItem(await loadSyncContext(admin, plaid), item);
      console.log(`${tag}: item ${item.id} → ${JSON.stringify(result)}`);
    })().catch((err) => console.error(`${tag}: background sync failed`, err)),
  );
  return ok();
});
