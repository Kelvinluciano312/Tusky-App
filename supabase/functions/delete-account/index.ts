import { createClient } from 'npm:@supabase/supabase-js@2';

import { deleteAccount, parseProof } from '../_shared/account.ts';
import { appleEnv, exchangeAppleCode, formPost, revokeAppleToken, verifyAppleIdentity } from '../_shared/apple.ts';
import { disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse, loggable, requireSecondStep } from '../_shared/lib.ts';
import { forgetRevenueCatUser } from '../_shared/revenuecat.ts';

/**
 * Delete the caller's account (Phase 14d). Banks go at Plaid first; any
 * failure there stops everything, and calling again finishes the job.
 * The body proves who is asking: { password }, or { apple: { identity_token,
 * authorization_code } } from a fresh Sign in with Apple (Phase 17), which also
 * lets us revoke Apple's grant. A password proof cannot revoke it: only an
 * Apple sign-in yields the code.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const blocked = await requireSecondStep(admin, req, user.id);
  if (blocked) return blocked;
  const plaid = getPlaidClient();
  const proof = parseProof(await req.json().catch(() => null));

  const herdOf = async (id: string) => {
    const { data, error } = await admin.from('herd_members').select('herd_id').eq('user_id', id).maybeSingle();
    if (error) throw error;
    return (data?.herd_id as string | undefined) ?? null;
  };

  try {
    const result = await deleteAccount({
      // A throwaway client: signing in here never touches the caller's own
      // session (replacing it in the app would drop a 2FA proof), and nothing persists.
      verifyPassword: async (_id, pw) => {
        if (!user.email) return false;
        const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await anon.auth.signInWithPassword({ email: user.email, password: pw });
        if (error) {
          // A wrong password is a 400 `invalid_credentials`; anything else
          // (rate limit, outage) must not read as "wrong", so it throws.
          if (error.status === 400) return false;
          throw error;
        }
        // Discard the throwaway session; local scope revokes only it, never the caller's.
        await anon.auth.signOut({ scope: 'local' }).catch(() => {});
        return data.user?.id === user.id;
      },
      // The Apple user to match comes from the caller's own identity, never from the request.
      verifyApple: async (id, identityToken) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error) throw error;
        const sub = data.user?.identities?.find((i) => i.provider === 'apple')?.identity_data?.sub;
        return typeof sub === 'string' && (await verifyAppleIdentity(identityToken, sub));
      },
      appleGrant: async (code) => {
        const env = appleEnv((k) => Deno.env.get(k));
        if (!env) {
          console.warn('apple: not configured, token not revoked');
          return null;
        }
        return await exchangeAppleCode(formPost, env, code, new Date());
      },
      revokeApple: async (refreshToken) => {
        const env = appleEnv((k) => Deno.env.get(k));
        if (!env) return;
        if (!(await revokeAppleToken(formPost, env, refreshToken, new Date()))) console.warn('apple: revoke was refused');
      },
      herdSize: async (id) => {
        const herd = await herdOf(id);
        if (!herd) return 0;
        const { count, error } = await admin
          .from('herd_members').select('user_id', { count: 'exact', head: true }).eq('herd_id', herd);
        if (error) throw error;
        return count ?? 0;
      },
      leaveHerd: async (id) => {
        const { error } = await admin.rpc('leave_herd', { p_user: id });
        if (error) throw error;
      },
      liveItems: async (id) => {
        const { data, error } = await admin
          .from('plaid_items').select('id, status').eq('user_id', id).neq('status', 'archived');
        if (error) throw error;
        return data ?? [];
      },
      disconnect: (item) => disconnectItem(admin, plaid, item, 'delete'),
      deletePersonalHerd: async (id) => {
        const { data, error } = await admin.rpc('delete_personal_herd', { p_user: id });
        if (error) throw error;
        return data === true;
      },
      deleteUser: async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
      },
      forgetPurchaser: (id) => forgetRevenueCatUser(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '', id),
    }, user.id, proof);

    if (result === 'wrong_password') return jsonResponse({ error: 'wrong_password' }, 403);
    if (result === 'apple_unverified') return jsonResponse({ error: 'apple_unverified' }, 403);
    if (result === 'plaid_failed') return jsonResponse({ error: 'plaid_failed' }, 502);
    if (result === 'busy') return jsonResponse({ error: 'busy' }, 409);
    console.log(`delete-account: deleted ${user.id}`);
    return jsonResponse({ deleted: true });
  } catch (err) {
    console.error(`delete-account failed for ${user.id}`, loggable(err));
    return jsonResponse({ error: 'delete_failed' }, 500);
  }
});
