import { runEnforcer, sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/**
 * The daily plan check (Phase 14b), called by pg_cron. Public, so the cron
 * secret is checked before anything else. It replies at once and works in the
 * background; { dry_run: true } instead waits and returns what it would do.
 */
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
  const plaid = getPlaidClient();
  if (body.dry_run === true) {
    return jsonResponse({ dry_run: true, reports: await runEnforcer(admin, plaid, new Date(), true) });
  }

  EdgeRuntime.waitUntil(
    runEnforcer(admin, plaid, new Date(), false)
      .then((reports) => {
        const acted = reports.filter((r) => r.archive.length > 0 || r.overLimitSince !== null);
        console.log(`plan-enforcer: ${reports.length} judged, ${acted.length} acted`, JSON.stringify(acted));
      })
      .catch((err) => console.error('plan-enforcer failed', err)),
  );
  return jsonResponse({ accepted: true }, 202);
});
