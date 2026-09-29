import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';
import { adminSubStore, revenueCatClient, syncSubscriber } from '../_shared/revenuecat.ts';

/**
 * The app calls this right after a purchase or restore (Phase 14c), so the new
 * plan shows without waiting for the webhook. It runs the webhook's own path
 * for the caller: RevenueCat is asked, the app is never believed.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    const result = await syncSubscriber(
      adminSubStore(admin),
      revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? ''),
      user.id,
      new Date(),
      Deno.env.get('PLAID_ENV') === 'sandbox',
    );
    return jsonResponse({ result });
  } catch (err) {
    console.error('plan-refresh failed', err);
    return jsonResponse({ error: 'refresh_failed' }, 502);
  }
});
