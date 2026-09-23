# Phase 2.5 (second half) — Plaid webhooks

Status: approved design
Date: 2026-09-22
Branch: `pedro`

## Context

Sync runs only when the app asks: pull-to-refresh, or right after Link. New transactions wait for
the user, and a broken bank login is only discovered by the next manual sync. The post-Link sync
also often lands before Plaid has pulled any data, so a freshly linked bank looks empty until the
user refreshes. Webhooks fix all three: Plaid tells us when there is data, and when a login breaks.

This is the project's **first public endpoint**. Plaid calls it, not a signed-in user, so
`getAuthedUser` cannot protect it. Plaid's ES256-signed JWT is the new trust boundary.

Riding along: the transaction feed hides transactions from hidden accounts. That matches Monarch,
and matches Home, whose net worth already filters `!hidden`.

## Verification

Every request carries a JWT in the `Plaid-Verification` header. It is authentic only if all hold:

- the JWT header's `alg` is `ES256`;
- the key named by the header's `kid`, fetched from `/webhook_verification_key/get`, verifies the
  signature, and that key has no `expired_at`;
- `iat` is at most 5 minutes old (replay guard);
- the SHA-256 of the **raw** request body equals the `request_body_sha256` claim, compared in
  constant time. Plaid hashes the body exactly as sent, so the body is read once as text and never
  re-serialized before hashing.

Keys are cached per `kid` for the life of the function instance. Anything that fails verification
gets **401**. An authentic webhook whose `environment` differs from `PLAID_ENV` is logged and
ignored with 200.

## Routing

Plaid retries any non-200 for up to 24 hours, so an authentic webhook always gets **200**, even
when we choose to do nothing with it.

| Webhook | Action |
|---|---|
| `TRANSACTIONS / SYNC_UPDATES_AVAILABLE` | sync that Item in the background |
| `ITEM / LOGIN_REPAIRED` | sync that Item in the background; a successful sync is what sets `active` |
| `ITEM / ERROR` with `error.error_code = ITEM_LOGIN_REQUIRED` | set `status = 'login_required'` |
| anything else, an unknown `item_id`, or a `disconnected` Item | log, then 200 |

**Deliberately not handled:** `PENDING_DISCONNECT` and `PENDING_EXPIRATION`. The credentials still
work during that window, so the next successful sync would flip the Item back to `active` and the
Reconnect prompt would flap. When access actually lapses, `ITEM_LOGIN_REQUIRED` fires and is
handled. Revocation codes are log-only for now too.

## Timing: reply, then sync

Plaid gives up on a delivery after 10 seconds, and a 90-day first sync can take longer. So the
function verifies, routes, replies 200, and runs the sync in `EdgeRuntime.waitUntil`.

A background sync that fails is healed by the next webhook or pull-to-refresh: the cursor makes a
re-run idempotent. The existing `sync_locked_at` claim makes a webhook sync safe to overlap with a
pull-to-refresh.

Accepted gap: a webhook that lands while an app-triggered sync of the same Item is mid-flight is
`skipped` by the claim, and anything Plaid added after that sync read its pages waits for the next
webhook or refresh.

The per-Item sync routine moves from `plaid-sync-transactions` into `_shared/sync.ts` so both
functions run the same code.

## Registration

New Links send `webhook` on `linkTokenCreate`, in both new and update mode. The URL is derived from
`SUPABASE_URL`, so there is no new secret.

Items linked before this change have no webhook URL. All of them are Sandbox Items, and production
Items would be linked fresh, so the dev tools register them: both sandbox dev actions call
`/item/webhook/update` before doing anything else.

## Dev tools

`plaid-sandbox-reset-login` becomes `plaid-sandbox`, taking `{ item_id, action }`:

- `reset_login` — as before. Plaid fires `ITEM_LOGIN_REQUIRED` on its own when the Item has a
  webhook. The app no longer syncs after pressing it, because a sync would hide whether the webhook
  did the work.
- `fire_webhook` — asks Plaid to fire `SYNC_UPDATES_AVAILABLE`.

Both guards stay: 403 unless `PLAID_ENV=sandbox`, and 404 unless the caller owns the Item. The
Settings buttons stay behind `__DEV__`.

## App freshness

TanStack Query's `focusManager` is wired to `AppState`, so returning to the app refetches. Webhooks
mostly arrive while the app is in the background, so this covers the common case. No Realtime.

## Testing

- Deno unit tests sign real ES256 tokens with a generated key pair and cover a valid token, a
  tampered body, a stale `iat`, a non-ES256 `alg`, a missing header, an unknown `kid`, and an
  expired key, plus one case per routing row.
- Live: an unauthenticated POST returns our own 401, which proves the gateway's JWT check is off and
  ours is on. The dev buttons drive the sync path and the error path on a device, confirmed by
  scoped database queries and the function logs.
