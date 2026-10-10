/**
 * What the app tells the server when Plaid Link closes without a bank
 * (`plaid-link-event`). Link runs on the phone, so its link_session_id and
 * error reach our troubleshooting log only if the app sends them.
 */

/** The SDK's LinkExit, structurally: this file must run under plain Node. */
export type LinkExitLike = {
  error?: { errorCode?: string; errorType?: string; errorMessage?: string } | null;
  metadata?: {
    status?: string;
    institution?: { id?: string; name?: string } | null;
    linkSessionId?: string;
    requestId?: string;
  } | null;
};

export type LinkExitBody = {
  link_session_id?: string;
  request_id?: string;
  institution_id?: string;
  status?: string;
  error_type?: string;
  error_code?: string;
  error_message?: string;
  /** Update mode: the bank being repaired. */
  item_id?: string;
};

/** Only the fields Link actually gave: an empty string is left out. */
export function linkExitBody(exit: LinkExitLike, itemId?: string): LinkExitBody {
  const fields: Record<keyof LinkExitBody, string | undefined> = {
    link_session_id: exit.metadata?.linkSessionId,
    request_id: exit.metadata?.requestId,
    institution_id: exit.metadata?.institution?.id,
    status: exit.metadata?.status,
    error_type: exit.error?.errorType,
    error_code: exit.error?.errorCode,
    error_message: exit.error?.errorMessage,
    item_id: itemId,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === 'string' && value !== ''),
  ) as LinkExitBody;
}
