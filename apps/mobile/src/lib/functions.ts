/** Helpers for calling Edge Functions from the app. */

import { notifyTwoFactorRequired, TWO_FACTOR_REQUIRED } from '@/lib/two-factor';

/** FunctionsHttpError carries the Response; its JSON body says what actually failed. */
export async function readFunctionError(
  err: unknown,
): Promise<{ status?: number; message?: string; body?: Record<string, unknown> }> {
  const response = (err as { context?: Response }).context;
  let message: string | undefined;
  let body: Record<string, unknown> | undefined;
  try {
    const parsed = await response?.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    if (typeof body?.error === 'string') message = body.error;
    // Two-step sign-in (16e): the session never proved a code. Send the gate to
    // look again, and give the caller words a person can read.
    if (message === TWO_FACTOR_REQUIRED) {
      notifyTwoFactorRequired();
      message = 'Confirm the code we email you to continue.';
    }
  } catch {
    // non-JSON body; the caller keeps its own wording
  }
  return { status: response?.status, message, body };
}
