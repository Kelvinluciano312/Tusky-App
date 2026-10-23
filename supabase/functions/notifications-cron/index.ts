// Hourly notification pass. Public, so the cron secret is checked first.
// { "dry_run": true } returns what it would send and does not call Expo.

import { sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, jsonResponse, loggable } from '../_shared/lib.ts';
import { runNotificationsCron } from '../_shared/push-cron.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // The cron sends {}; an empty body is the same.
  }
  const admin = getAdminClient();
  const now = new Date();
  if (body.dry_run === true) {
    try {
      return jsonResponse({ dry_run: true, ...(await runNotificationsCron(admin, now, true)) });
    } catch (err) {
      console.error('notifications-cron dry run failed', loggable(err));
      return jsonResponse({ error: 'failed' }, 500);
    }
  }
  EdgeRuntime.waitUntil(
    runNotificationsCron(admin, now, false)
      .then((report) => console.log(`notifications-cron: sent ${report.sent}, deferred ${report.deferred}`))
      .catch((err) => console.error('notifications-cron failed', loggable(err))),
  );
  return jsonResponse({ accepted: true }, 202);
});
