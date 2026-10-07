/**
 * The Plaid troubleshooting log (plaid_events). Plaid support asks for a
 * request_id, Plaid's item_id and Link's link_session_id; this is where they
 * are kept. The readers are pure and pinned by plaid-log.test.ts;
 * recordPlaidEvent does the I/O and never throws: a lost log row must never
 * fail a sync, a link or a disconnect.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { loggable } from './lib.ts';

export type PlaidEventName =
  | 'link_token_failed'
  | 'exchange_ok'
  | 'exchange_failed'
  | 'sync_failed'
  | 'login_required'
  | 'remove_failed'
  | 'link_exit';

export type PlaidEvent = {
  event: PlaidEventName;
  user_id?: string | null;
  /** Our plaid_items.id. */
  item_id?: string | null;
  /** Plaid's own item_id. Looked up from item_id when left out. */
  plaid_item_id?: string | null;
  request_id?: string | null;
  link_session_id?: string | null;
  institution_id?: string | null;
  link_status?: string | null;
  error_type?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

const ID_MAX = 200;
const MESSAGE_MAX = 500;
/** A signed-in user may report this many Link exits an hour (plaid-link-event). */
export const LINK_EXITS_PER_HOUR = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A text field as stored: a trimmed, non-empty string cut to max. Anything else is null. */
export function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/**
 * What a caught error says about itself. Reads ONLY response.data and
 * err.message: a Plaid SDK error's config holds our secret and may hold an
 * access token (see loggable).
 */
export function plaidErrorFields(
  err: unknown,
): Pick<PlaidEvent, 'request_id' | 'error_type' | 'error_code' | 'error_message'> {
  const data = (err as { response?: { data?: Record<string, unknown> } } | null)?.response?.data;
  const fields = data && typeof data === 'object' ? data : {};
  return {
    request_id: clip(fields.request_id, ID_MAX),
    error_type: clip(fields.error_type, ID_MAX),
    error_code: clip(fields.error_code, ID_MAX),
    error_message: clip(fields.error_message, MESSAGE_MAX) ?? clip((err as { message?: unknown } | null)?.message, MESSAGE_MAX),
  };
}

/** The row to insert: every column present, every text clipped. */
export function eventRow(event: PlaidEvent): Required<PlaidEvent> {
  return {
    event: event.event,
    user_id: event.user_id ?? null,
    item_id: event.item_id ?? null,
    plaid_item_id: clip(event.plaid_item_id, ID_MAX),
    request_id: clip(event.request_id, ID_MAX),
    link_session_id: clip(event.link_session_id, ID_MAX),
    institution_id: clip(event.institution_id, ID_MAX),
    link_status: clip(event.link_status, ID_MAX),
    error_type: clip(event.error_type, ID_MAX),
    error_code: clip(event.error_code, ID_MAX),
    error_message: clip(event.error_message, MESSAGE_MAX),
  };
}

/**
 * A Link exit as the app reports it. The body is the client's word: nothing in
 * it is trusted beyond being text, and the user is always the caller. Null
 * when the body is not an object.
 */
export function linkExitEvent(body: unknown, userId: string): PlaidEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  return {
    event: 'link_exit',
    user_id: userId,
    item_id: typeof b.item_id === 'string' && UUID.test(b.item_id) ? b.item_id : null,
    link_session_id: clip(b.link_session_id, ID_MAX),
    request_id: clip(b.request_id, ID_MAX),
    institution_id: clip(b.institution_id, ID_MAX),
    link_status: clip(b.status, ID_MAX),
    error_type: clip(b.error_type, ID_MAX),
    error_code: clip(b.error_code, ID_MAX),
    error_message: clip(b.error_message, MESSAGE_MAX),
  };
}

/** Write one event. Never throws. */
export async function recordPlaidEvent(admin: SupabaseClient, event: PlaidEvent): Promise<void> {
  try {
    const row = eventRow(event);
    if (row.item_id && (!row.plaid_item_id || !row.user_id)) {
      const { data } = await admin
        .from('plaid_items').select('plaid_item_id, user_id').eq('id', row.item_id).maybeSingle();
      row.plaid_item_id = row.plaid_item_id ?? data?.plaid_item_id ?? null;
      row.user_id = row.user_id ?? data?.user_id ?? null;
    }
    const { error } = await admin.from('plaid_events').insert(row);
    if (error) console.warn(`plaid event ${event.event} not recorded: ${error.message}`);
  } catch (err) {
    console.warn(`plaid event ${event.event} not recorded`, loggable(err));
  }
}
