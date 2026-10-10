// The app reports how Plaid Link closed without a bank: the user backed out,
// or Link failed. Link runs on the phone, so this is the only way its
// link_session_id and error reach the troubleshooting log (plaid_events).
// JWT-verified by default. The body is the client's word: see linkExitEvent.

import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse, requireSecondStep } from '../_shared/lib.ts';
import { LINK_EXITS_PER_HOUR, linkExitEvent, recordPlaidEvent } from '../_shared/plaid-log.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const blocked = await requireSecondStep(admin, req, user.id);
  if (blocked) return blocked;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // falls through to the check below
  }
  const event = linkExitEvent(body, user.id);
  if (!event) return jsonResponse({ error: 'Invalid body' }, 400);

  // A log anyone signed in can write to needs a ceiling.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from('plaid_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('event', 'link_exit')
    .gte('created_at', since);
  if (countError) {
    console.error('link-event count failed', countError);
    return jsonResponse({ error: 'Could not record' }, 500);
  }
  if ((count ?? 0) >= LINK_EXITS_PER_HOUR) return jsonResponse({ error: 'too_many' }, 429);

  // item_id comes from the client (update mode). Keep it only if it is the
  // caller's own: recordPlaidEvent would otherwise copy another Item's Plaid id.
  if (event.item_id) {
    const { data: own } = await admin
      .from('plaid_items').select('id').eq('id', event.item_id).eq('user_id', user.id).maybeSingle();
    if (!own) event.item_id = null;
  }

  await recordPlaidEvent(admin, event);
  console.log(
    `link exit: user ${user.id}, session ${event.link_session_id}, status ${event.link_status}, error ${event.error_code}`,
  );
  return jsonResponse({ ok: true });
});
