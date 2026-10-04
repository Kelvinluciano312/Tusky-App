import { deleteAccount } from '../_shared/account.ts';
import { disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
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
  const plaid = getPlaidClient();

  const herdOf = async (id: string) => {
    const { data, error } = await admin.from('herd_members').select('herd_id').eq('user_id', id).maybeSingle();
    if (error) throw error;
    return (data?.herd_id as string | undefined) ?? null;
  };

  try {
    const result = await deleteAccount({
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
    }, user.id);

    if (result === 'plaid_failed') return jsonResponse({ error: 'plaid_failed' }, 502);
    if (result === 'busy') return jsonResponse({ error: 'busy' }, 409);
    console.log(`delete-account: deleted ${user.id}`);
    return jsonResponse({ deleted: true });
  } catch (err) {
    console.error(`delete-account failed for ${user.id}`, err);
    return jsonResponse({ error: 'delete_failed' }, 500);
  }
});
