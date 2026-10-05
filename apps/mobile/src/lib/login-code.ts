// The emailed sign-in code (Phase 16e): the one impure edge of two-step
// sign-in, shared by the code screen and the Account & privacy sheet. The
// rules around it (digits, countdown, the gate) are pure, in `two-factor.ts`.

import { readFunctionError } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { codeFailureMessage } from '@/lib/two-factor';

/** Email a sign-in code to an existing account. Returns an error message, or null when it was sent. */
export async function sendLoginCode(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (!error) return null;
  // Supabase rate-limits sends per address; say so plainly rather than "failed".
  if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
    return 'A code was sent a moment ago. Wait a minute, then ask for another.';
  }
  return 'We could not send a code. Check your connection and try again.';
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
