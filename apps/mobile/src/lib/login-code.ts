// The emailed sign-in code (Phase 16e): the one impure edge of two-step
// sign-in, shared by the code screen and the Account & privacy sheet. The
// rules around it (digits, countdown, the gate) are pure, in `two-factor.ts`.

import { supabase } from '@/lib/supabase';
import { WRONG_CODE_MESSAGE } from '@/lib/two-factor';

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
 * Check the code. Success REPLACES the session with one whose `amr` includes
 * `otp`; the session listener then re-renders the root gate. Returns an error
 * message, or null.
 */
export async function confirmLoginCode(email: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (!error) return null;
  // A network failure has no status; a wrong or expired code is a 4xx.
  if (error.status && error.status >= 400 && error.status < 500) return WRONG_CODE_MESSAGE;
  return 'We could not check the code. Check your connection and try again.';
}
