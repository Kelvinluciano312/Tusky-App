/** Helpers for calling Edge Functions from the app. */

/** FunctionsHttpError carries the Response; its JSON body says what actually failed. */
export async function readFunctionError(err: unknown): Promise<{ status?: number; message?: string }> {
  const response = (err as { context?: Response }).context;
  let message: string | undefined;
  try {
    const body = await response?.json();
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // non-JSON body; the caller keeps its own wording
  }
  return { status: response?.status, message };
}
