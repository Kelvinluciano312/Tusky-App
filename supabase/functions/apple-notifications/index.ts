import { verifyAppleNotification } from '../_shared/apple.ts';
import { getAdminClient, jsonResponse, loggable } from '../_shared/lib.ts';

/**
 * Apple's server-to-server notifications for Sign in with Apple (Phase 17).
 * Public: Apple calls it, not a user, so the signed message IS the auth and is
 * checked before anything else runs. A person who stops using Sign in with
 * Apple for Tusky, or deletes their Apple ID, is signed out everywhere. Their
 * data is never deleted here: that stays their own choice, and an orphaned
 * account's banks are archived by plan-enforcer when its trial ends.
 */
const ENDS_SESSIONS = new Set(['consent-revoked', 'account-delete']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  let signed: unknown = null;
  try {
    signed = ((await req.json()) as { payload?: unknown } | null)?.payload;
  } catch {
    // Unreadable: refused below like any other message that is not Apple's.
  }
  const event = typeof signed === 'string' ? await verifyAppleNotification(signed) : null;
  if (!event) return jsonResponse({ error: 'Unauthorized' }, 401);

  // The type is logged and the Apple user never is: it identifies a person.
  console.log('apple-notifications:', event.type);
  if (ENDS_SESSIONS.has(event.type)) {
    try {
      const admin = getAdminClient();
      const { data: userId, error } = await admin.rpc('user_for_apple_sub', { p_sub: event.sub });
      if (error) throw error;
      if (typeof userId === 'string') {
        const { error: endError } = await admin.rpc('end_user_sessions', { p_user: userId });
        if (endError) throw endError;
      }
    } catch (err) {
      // Apple retries a non-200, so a database hiccup is worth one.
      console.error('apple-notifications failed', loggable(err));
      return jsonResponse({ error: 'failed' }, 500);
    }
  }
  return jsonResponse({ ok: true });
});
