// Sends pushes. Public, like plan-enforcer: Postgres (questions) and other
// functions call it with the push secret, not a user JWT. The body names the
// event; the rows are loaded here, so a caller cannot invent a message.

import { sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, jsonResponse, loggable } from '../_shared/lib.ts';
import { onQuestionAnswered, onQuestionAsked } from '../_shared/push-events.ts';

type Event = { kind?: string; question_id?: string; transaction_id?: string };

Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get('x-push-secret'), Deno.env.get('PUSH_SECRET'))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  let body: { events?: Event[] } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad_body' }, 400);
  }
  const events = Array.isArray(body.events) ? body.events : [];
  const admin = getAdminClient();
  const now = new Date();
  let handled = 0;
  for (const event of events) {
    try {
      if (event.kind === 'question_asked' && event.question_id) {
        await onQuestionAsked(admin, event.question_id, now);
        handled++;
      } else if (event.kind === 'question_answered' && event.transaction_id) {
        await onQuestionAnswered(admin, event.transaction_id, now);
        handled++;
      }
    } catch (err) {
      console.error(`send-push ${event.kind} failed`, loggable(err));
    }
  }
  return jsonResponse({ ok: true, handled });
});
