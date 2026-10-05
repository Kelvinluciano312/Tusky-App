import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';
import {
  claimsOfToken,
  lockedOut,
  markableSession,
  verifyFailure,
  WRONG_CODE_WINDOW_MINUTES,
} from '../_shared/two-factor.ts';

/**
 * The second step of sign-in (Phase 16e): POST { code }. The caller's session
 * must already have proved the password; the emailed code is then checked on a
 * throwaway client and the CALLER'S session is marked in two_factor_sessions.
 * A session made by verifyOtp alone (amr otp: a mailbox, no password) can never
 * be marked, so the code is a second step and never a replacement for the
 * password.
 *
 * This function deliberately does NOT call requireSecondStep: it is how a
 * session becomes verified.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user || !user.email) return jsonResponse({ error: 'Unauthorized' }, 401);

  const token = (req.headers.get('Authorization') ?? '').slice('Bearer '.length);
  const mark = markableSession(claimsOfToken(token));
  if (!mark) return jsonResponse({ error: 'password_session_required' }, 403);

  let code = '';
  try {
    const body = await req.json();
    code = typeof body?.code === 'string' ? body.code.trim() : '';
  } catch {
    // falls through to the shape check
  }
  if (!/^\d{6,10}$/.test(code)) return jsonResponse({ error: 'wrong_code' }, 403);

  try {
    // Too many wrong codes for this session lately? Rows of this session older
    // than the window are dropped first, so the table stays tiny.
    const since = new Date(Date.now() - WRONG_CODE_WINDOW_MINUTES * 60_000).toISOString();
    await admin.from('two_factor_failures').delete().eq('session_id', mark.sessionId).lt('created_at', since);
    const { count, error: countError } = await admin
      .from('two_factor_failures')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', mark.sessionId);
    if (countError) throw countError;
    if (lockedOut(count ?? 0)) return jsonResponse({ error: 'too_many_attempts' }, 429);

    // A throwaway anon client: its own session is revoked right after, so no
    // dangling session survives and the caller's sessions are untouched.
    const probe = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await probe.auth.verifyOtp({ email: user.email, token: code, type: 'email' });
    if (error || !data.session) {
      const failure = verifyFailure(error?.status);
      if (failure === 'wrong_code') {
        await admin.from('two_factor_failures').insert({ session_id: mark.sessionId });
        return jsonResponse({ error: 'wrong_code' }, 403);
      }
      if (failure === 'too_many_attempts') return jsonResponse({ error: 'too_many_attempts' }, 429);
      console.error('two-factor: verifyOtp unavailable', error?.status, error?.message);
      return jsonResponse({ error: 'verify_unavailable' }, 502);
    }
    // A session that survives would only ever be an unmarkable otp one, so a
    // failed revoke is worth a log line, not a failed sign-in.
    const { error: revokeError } = await probe.auth.signOut({ scope: 'local' });
    if (revokeError) console.error('two-factor: could not revoke the probe session', revokeError.message);

    const { error: markError } = await admin
      .from('two_factor_sessions')
      .upsert({ session_id: mark.sessionId, user_id: user.id }, { onConflict: 'session_id' });
    if (markError) throw markError;
    await admin.from('two_factor_failures').delete().eq('session_id', mark.sessionId);
    return jsonResponse({ verified: true });
  } catch (err) {
    console.error('two-factor failed', err);
    return jsonResponse({ error: 'two_factor_failed' }, 500);
  }
});
