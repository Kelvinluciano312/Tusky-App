// The emailed sign-in code (Phase 16e): the one impure edge of two-step
// sign-in, shared by the code screen and the Account & privacy sheet. The
// rules around it (digits, countdown, the gate) are pure, in `two-factor.ts`.

import { readFunctionError } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { codeFailureMessage, sendFailure } from '@/lib/two-factor';

/**
 * Email a sign-in code to an existing account. Returns null when it was sent,
 * else a message and whether a code is on its way anyway (`sent`: the rate
 * limit means one went out a moment ago, so the countdown should run).
 */
export async function sendLoginCode(email: string): Promise<{ message: string; sent: boolean } | null> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return error ? sendFailure(error) : null;
}

/**
 * Check the code. The `two-factor` function verifies it on the server and marks
 * THIS session as verified; the session itself is not replaced, so the caller
 * only has to ask the gate to look again (the first-run query). The function
 * refuses a session that did not sign in with a password. Returns an error
 * message, or null.
 */
export async function confirmLoginCode(code: string): Promise<string | null> {
  const { error } = await supabase.functions.invoke('two-factor', { body: { code } });
  if (!error) return null;
  const { message } = await readFunctionError(error);
  return codeFailureMessage(message);
}
