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
  /** ios or android. Anything else is left out. */
  platform?: 'ios' | 'android';
};

/** Link events worth a troubleshooting row. The rest of Link's stream stays on the phone. */
export const FORWARDED_LINK_EVENTS = ['OPEN', 'SELECT_INSTITUTION', 'ERROR'] as const;
export type ForwardedLinkEvent = (typeof FORWARDED_LINK_EVENTS)[number];

/** The SDK's LinkEvent, structurally, so this file stays free of the native module. */
export type LinkEventLike = {
  eventName?: string;
  metadata?: {
    linkSessionId?: string;
    requestId?: string;
    institutionId?: string;
    errorCode?: string;
    errorMessage?: string;
    errorType?: string;
  } | null;
};

export type LinkEventBody = LinkExitBody & { event: ForwardedLinkEvent };

function phonePlatform(value: string | undefined): 'ios' | 'android' | undefined {
  return value === 'ios' || value === 'android' ? value : undefined;
}

/** Only the fields Link actually gave: an empty string is left out. */
export function linkExitBody(exit: LinkExitLike, itemId?: string, platform?: string): LinkExitBody {
  const fields: Record<keyof LinkExitBody, string | undefined> = {
    link_session_id: exit.metadata?.linkSessionId,
    request_id: exit.metadata?.requestId,
    institution_id: exit.metadata?.institution?.id,
    status: exit.metadata?.status,
    error_type: exit.error?.errorType,
    error_code: exit.error?.errorCode,
    error_message: exit.error?.errorMessage,
    item_id: itemId,
    platform: phonePlatform(platform),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === 'string' && value !== ''),
  ) as LinkExitBody;
}

/** OPEN, SELECT_INSTITUTION and ERROR, or null when this event is not one of those. */
export function linkEventBody(event: LinkEventLike, itemId?: string, platform?: string): LinkEventBody | null {
  if (!event.eventName || !(FORWARDED_LINK_EVENTS as readonly string[]).includes(event.eventName)) return null;
  const meta = event.metadata;
  const fields: Record<string, string | undefined> = {
    event: event.eventName,
    link_session_id: meta?.linkSessionId,
    request_id: meta?.requestId,
    institution_id: meta?.institutionId,
    error_type: meta?.errorType,
    error_code: meta?.errorCode,
    error_message: meta?.errorMessage,
    item_id: itemId,
    platform: phonePlatform(platform),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === 'string' && value !== ''),
  ) as LinkEventBody;
}
