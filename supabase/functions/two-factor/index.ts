import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';
import {
  claimsOfRequest,
  markableSession,
  MAX_WRONG_CODES,
  MAX_WRONG_CODES_PER_USER,
  reservedAttempt,
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

  const mark = markableSession(claimsOfRequest(req));
  if (!mark) return jsonResponse({ error: 'password_session_required' }, 403);

  let code = '';
  try {
    const body = await req.json();
    code = typeof body?.code === 'string' ? body.code.trim() : '';
  } catch {
    // falls through to the shape check
  }
  if (!/^\d{6,10}$/.test(code)) return jsonResponse({ error: 'wrong_code' }, 403);

  // An attempt is RESERVED before the code is checked (take_two_factor_attempt,
  // atomic per user), so parallel guesses cannot all slip past a count taken
  // earlier. The budget is per session AND per user, so signing in again is
  // not a fresh one. A wrong code keeps its attempt; success clears the user's;
  // a check that could not run (outage) refunds the one just taken.
  let attemptId: number | null = null;
  const refund = async () => {
    if (attemptId !== null) await admin.from('two_factor_failures').delete().eq('id', attemptId);
    attemptId = null;
  };
  try {
    const { data: reserved, error: reserveError } = await admin.rpc('take_two_factor_attempt', {
      p_session: mark.sessionId,
      p_user: user.id,
      p_max_session: MAX_WRONG_CODES,
      p_max_user: MAX_WRONG_CODES_PER_USER,
      p_window_minutes: WRONG_CODE_WINDOW_MINUTES,
    });
    if (reserveError) throw reserveError;
    attemptId = reservedAttempt(reserved);
    if (attemptId === null) return jsonResponse({ error: 'too_many_attempts' }, 429);

    // A throwaway anon client: its own session is revoked right after, so no
    // dangling session survives and the caller's sessions are untouched.
    const probe = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await probe.auth.verifyOtp({ email: user.email, token: code, type: 'email' });
    if (error || !data.session) {
      const failure = verifyFailure(error?.status, error?.code);
      if (failure === 'wrong_code') return jsonResponse({ error: 'wrong_code' }, 403);
      // The code was never judged: give the attempt back.
      await refund();
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
    await admin.from('two_factor_failures').delete().eq('user_id', user.id);
    return jsonResponse({ verified: true });
  } catch (err) {
    console.error('two-factor failed', err);
    await refund().catch(() => {});
    return jsonResponse({ error: 'two_factor_failed' }, 500);
  }
});
