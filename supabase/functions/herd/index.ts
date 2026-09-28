// Herd membership (Phase 9c): invite codes, joining, leaving, removing a member.
// Join and leave are single SQL functions (merge_into_herd, leave_herd) that
// only the service role may execute, so each runs in one transaction.
// JWT-verified by default: no config.toml entry.

import { describeMembershipError, generateCode, MAX_MEMBERS, parseHerdRequest } from '../_shared/herd.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getCallerHerd, jsonResponse } from '../_shared/lib.ts';

const MAX_PENDING_INVITES = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const input = parseHerdRequest(body);
  if ('error' in input) return jsonResponse({ error: input.error }, 400);

  // A refusal from merge_into_herd or leave_herd, or a server fault.
  const fromRpc = (err: { message?: string }) => {
    const known = describeMembershipError(err.message);
    if (known) return jsonResponse({ error: known.error }, known.status);
    throw err;
  };

  try {
    const me = await getCallerHerd(admin, user.id);
    const ownerOnly = () => jsonResponse({ error: 'Only the herd owner can do that' }, 403);

    switch (input.action) {
      case 'create_invite': {
        if (me.role !== 'owner') return ownerOnly();
        const { count: members, error: membersError } = await admin
          .from('herd_members').select('user_id', { count: 'exact', head: true }).eq('herd_id', me.herd_id);
        if (membersError) throw membersError;
        if ((members ?? 0) >= MAX_MEMBERS) {
          return jsonResponse({ error: `Your herd is full (${MAX_MEMBERS} members).` }, 409);
        }
        const { count: pending, error: pendingError } = await admin
          .from('herd_invites').select('code', { count: 'exact', head: true })
          .eq('herd_id', me.herd_id).is('accepted_at', null).gt('expires_at', new Date().toISOString());
        if (pendingError) throw pendingError;
        if ((pending ?? 0) >= MAX_PENDING_INVITES) {
          return jsonResponse({ error: 'Too many open invites. Cancel one first.' }, 409);
        }
        // 40 random bits: a collision is near impossible, but the primary key would refuse it.
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error } = await admin
            .from('herd_invites')
            .insert({ code: generateCode(), herd_id: me.herd_id, created_by: user.id })
            .select('code, expires_at')
            .single();
          if (!error) return jsonResponse(data);
          if (error.code !== '23505') throw error;
        }
        throw new Error('could not generate a unique invite code');
      }

      case 'revoke_invite': {
        if (me.role !== 'owner') return ownerOnly();
        const { error } = await admin
          .from('herd_invites').delete()
          .eq('code', input.code).eq('herd_id', me.herd_id).is('accepted_at', null);
        if (error) throw error;
        return jsonResponse({ ok: true });
      }

      case 'preview_invite': {
        const { data: invite, error } = await admin
          .from('herd_invites')
          .select('herd_id, created_by, expires_at, accepted_at, herds(name)')
          .eq('code', input.code)
          .maybeSingle();
        if (error) throw error;
        if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date()) {
          return fromRpc({ message: 'invite_invalid' });
        }
        const [{ data: inviter }, { count: members }, { count: mine }] = await Promise.all([
          admin.from('profiles').select('display_name').eq('user_id', invite.created_by).maybeSingle(),
          admin.from('herd_members').select('user_id', { count: 'exact', head: true }).eq('herd_id', invite.herd_id),
          admin.from('herd_members').select('user_id', { count: 'exact', head: true }).eq('herd_id', me.herd_id),
        ]);
        // Why the caller can't join, if they can't; the join itself re-checks all of it.
        const blocked = invite.herd_id === me.herd_id
          ? 'already_member'
          : (mine ?? 0) > 1
            ? 'not_alone'
            : (members ?? 0) >= MAX_MEMBERS
              ? 'herd_full'
              : null;
        return jsonResponse({
          herd_name: (invite.herds as unknown as { name: string } | null)?.name ?? 'A herd',
          inviter_name: inviter?.display_name ?? 'Someone',
          member_count: members ?? 0,
          expires_at: invite.expires_at,
          blocked: blocked ? describeMembershipError(blocked)!.error : null,
        });
      }

      case 'join': {
        const { data, error } = await admin.rpc('merge_into_herd', {
          p_user: user.id,
          p_code: input.code,
          p_private_accounts: input.private_account_ids,
        });
        if (error) return fromRpc(error);
        return jsonResponse(data);
      }

      case 'leave': {
        const { data, error } = await admin.rpc('leave_herd', { p_user: user.id });
        if (error) return fromRpc(error);
        return jsonResponse({ herd_id: data });
      }

      case 'remove_member': {
        if (me.role !== 'owner') return ownerOnly();
        if (input.user_id === user.id) return jsonResponse({ error: 'Use Leave to leave your own herd' }, 400);
        const { data: member, error: memberError } = await admin
          .from('herd_members').select('user_id')
          .eq('herd_id', me.herd_id).eq('user_id', input.user_id).maybeSingle();
        if (memberError) throw memberError;
        if (!member) return jsonResponse({ error: 'Not a member of your herd' }, 404);
        const { error } = await admin.rpc('leave_herd', { p_user: input.user_id });
        if (error) return fromRpc(error);
        return jsonResponse({ ok: true });
      }
    }
  } catch (err) {
    console.error(`herd ${input.action} failed for ${user.id}`, err);
    return jsonResponse({ error: 'Something went wrong. Try again in a moment.' }, 500);
  }
});
