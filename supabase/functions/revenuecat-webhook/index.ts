import { sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, jsonResponse } from '../_shared/lib.ts';
import { adminSubStore, eventUserIds, revenueCatClient, syncSubscriber } from '../_shared/revenuecat.ts';

/**
 * RevenueCat's webhook (Phase 14c). Public, so the shared Authorization value
 * is checked before anything else. The body only says whom to look at: each
 * user's state is re-fetched from RevenueCat and written from there.
 */
Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get('Authorization'), Deno.env.get('REVENUECAT_WEBHOOK_SECRET'))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // An unreadable body names nobody; it is answered 200 below.
  }
  const ids = eventUserIds(body);
  if (ids.length === 0) {
    console.log('revenuecat-webhook: no Tusky user in event', (body as { event?: { type?: unknown } } | null)?.event?.type);
    return jsonResponse({ ok: true, users: 0 });
  }

  const db = adminSubStore(getAdminClient());
  const rc = revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '');
  const allowTest = Deno.env.get('PLAID_ENV') === 'sandbox';
  try {
    const results = [];
    for (const id of ids) results.push([id, await syncSubscriber(db, rc, id, new Date(), allowTest)]);
    console.log('revenuecat-webhook', JSON.stringify(results));
    return jsonResponse({ ok: true, users: ids.length });
  } catch (err) {
    // RevenueCat or the database failed: a non-200 makes RevenueCat retry.
    console.error('revenuecat-webhook failed', err);
    return jsonResponse({ error: 'sync_failed' }, 500);
  }
});
