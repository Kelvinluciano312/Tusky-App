import { createClient } from 'npm:@supabase/supabase-js@2';

import { deleteAccount } from '../_shared/account.ts';
import { disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse, loggable, requireSecondStep } from '../_shared/lib.ts';
import { forgetRevenueCatUser } from '../_shared/revenuecat.ts';

/**
 * Delete the caller's account (Phase 14d). Banks go at Plaid first; any
 * failure there stops everything, and calling again finishes the job.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const blocked = await requireSecondStep(admin, req, user.id);
  if (blocked) return blocked;
  const plaid = getPlaidClient();
  const body = await req.json().catch(() => ({}));
  const password: unknown = body?.password;

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
      herdOf,
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
      deleteHerd: async (herd) => {
        const { error } = await admin.from('herds').delete().eq('id', herd);
        if (error) throw error;
      },
      deleteUser: async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
      },
      forgetPurchaser: (id) => forgetRevenueCatUser(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '', id),
    }, user.id, password);

    if (result === 'wrong_password') return jsonResponse({ error: 'wrong_password' }, 403);
    if (result === 'plaid_failed') return jsonResponse({ error: 'plaid_failed' }, 502);
    if (result === 'busy') return jsonResponse({ error: 'busy' }, 409);
    console.log(`delete-account: deleted ${user.id}`);
    return jsonResponse({ deleted: true });
  } catch (err) {
    console.error(`delete-account failed for ${user.id}`, loggable(err));
    return jsonResponse({ error: 'delete_failed' }, 500);
  }
});
