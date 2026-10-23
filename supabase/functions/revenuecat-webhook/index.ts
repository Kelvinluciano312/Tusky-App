import { sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, jsonResponse, loggable } from '../_shared/lib.ts';
import { notifyGrace } from '../_shared/push-events.ts';
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

  const admin = getAdminClient();
  const db = adminSubStore(admin);
  const rc = revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '');
  const allowTest = Deno.env.get('PLAID_ENV') === 'sandbox';
  try {
    const results = [];
    for (const id of ids) {
      const outcome = await syncSubscriber(db, rc, id, new Date(), allowTest);
      results.push([id, outcome]);
      if (outcome === 'written') {
        const { data } = await admin.from('subscriptions').select('status, expires_at').eq('user_id', id).maybeSingle();
        if (data?.status === 'grace') {
          try {
            await notifyGrace(admin, id, (data.expires_at as string | null) ?? null);
          } catch (err) {
            console.warn(`grace push failed for ${id}`, loggable(err));
          }
        }
      }
    }
    console.log('revenuecat-webhook', JSON.stringify(results));
    return jsonResponse({ ok: true, users: ids.length });
  } catch (err) {
    // RevenueCat or the database failed: a non-200 makes RevenueCat retry.
    console.error('revenuecat-webhook failed', err);
    return jsonResponse({ error: 'sync_failed' }, 500);
  }
});
