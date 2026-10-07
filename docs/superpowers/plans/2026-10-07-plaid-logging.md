# Plaid Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the identifiers Plaid support asks for (`request_id`, Plaid's `item_id`, `link_session_id`, error code) in a server-only table Pedro and Kelvyn can read, and document how to suspend a user from the Supabase dashboard.

**Architecture:** One server-only table, `plaid_events`, written through one never-throwing helper (`recordPlaidEvent` in `_shared/plaid-log.ts`). The Edge Functions that talk to Plaid call it where they already catch errors. The app reports Link exits to a new small function, `plaid-link-event`, and passes `link_session_id` along with the token exchange. Console lines stay, and `loggable` gains the `request_id`.

**Tech Stack:** Supabase Postgres (migration, pg_cron), Deno Edge Functions (`npm:plaid@30`, `npm:@supabase/supabase-js@2`), Expo SDK 57 app (`react-native-plaid-link-sdk` 13.0.2), `node --test`, `deno test`.

**Spec:** none. The Context section below is the spec.

## Context

Plaid granted production access on 2026-10-07. Its launch checklist has a Logging item: log events and errors with `item_id`, `request_id`, `account_id` and `link_session_id`, because support tickets and the Item Debugger need them.

What exists today:

- Server errors go through `loggable(err)` (`supabase/functions/_shared/lib.ts:109`), which keeps only Plaid's code and message. No `request_id`.
- Log lines name our own uuid for an Item, not Plaid's `item_id` (column `plaid_items.plaid_item_id`). Only `plaid-webhook` logs Plaid's id.
- The app drops Link's `linkSessionId`, `requestId` and error code: `onExit` in `apps/mobile/src/lib/plaid.ts:91` shows the message and nothing else.
- `account_id` is already stored (`accounts.plaid_account_id`). Nothing to do.
- Production is on Supabase's Free plan, where function logs last about a day. A table is what makes the identifiers survive until a user writes in.

Decisions Pedro made (2026-10-07):

- **Storage:** a database table, pruned after 90 days, deleted with the user's account.
- **Suspension:** runbook only. The dashboard's Ban user is enough for now; no code, no custom dashboard.

## Global Constraints

- Branch `pedro-plaid-logging` from `master`. `master` has uncommitted changes in `apps/mobile/app.json`, `eas.json`, `package.json`, `package-lock.json`: they are Pedro's. Never stage them. Always `git add` by explicit path.
- Never log or store a caught Plaid error whole. It carries the `PLAID-SECRET` header and sometimes an access token. Only `response.data` fields and `err.message` may be read.
- `recordPlaidEvent` must never throw and never fail a Plaid flow. A lost log row is acceptable; a failed sync or link because of logging is not.
- `plaid_events` is server-only: RLS on, no policies, no grants to `anon` or `authenticated`.
- Dev only. The CLI is linked to dev (`ifibrsgqdibcomzxencf`). Never pass `--project-ref`. Never run `secrets set --env-file`. Production rollout is Task 7's last step and waits for Pedro.
- Supabase CLI is pinned: `npx -y supabase@2.118.0 …`.
- PowerShell 5.1: no `&&`; no double quotes inside a `git commit -m` message; commit with `-F <file>` when in doubt.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use the model actually running).
- Create the PR; never merge it. PRs go to `Kelvinluciano312/Tusky-App`, base `master`, with `--body-file`.
- App code: text via `AppText`, no `Alert`. This plan adds no UI.
- App tests: a module under test imports others only as `import type` or by relative `./x.ts`. Each test file starts with `/// <reference types="node" />`.

## Review Focus

1. **The log table is unreachable or rejects the insert.** The sync, link or disconnect must finish exactly as before. Pinned in Task 3 (`recordPlaidEvent` resolves on an insert error and on a thrown client).
2. **The caught error is not a Plaid error** (a database error, or a network error with no response). A row is still written with the message and null Plaid fields. Pinned in Task 3.
3. **A hostile or broken Link-exit body**: not an object, non-string fields, 10,000-character strings, a non-uuid `item_id`. Nothing throws; fields are clipped or nulled. Pinned in Task 3 (`linkExitEvent`).
4. **A Link exit naming another user's Item.** The row must not carry that Item or its Plaid id. Pinned in Task 5 (ownership check, exercised in Task 7's script).
5. **Secrets in the stored row.** `plaidErrorFields` must never pass the request config through. Pinned in Task 3.

A sixth, smaller one: a signed-in user flooding `plaid-link-event`. Capped at 30 exits per user per hour (Task 5).

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261017120000_plaid_events.sql` (create) | The table, its indexes, lock-down, and the daily prune job |
| `supabase/functions/_shared/plaid-log.ts` (create) | Pure field readers (`clip`, `plaidErrorFields`, `eventRow`, `linkExitEvent`) and `recordPlaidEvent` |
| `supabase/functions/_shared/plaid-log.test.ts` (create) | Tests for the above |
| `supabase/functions/_shared/lib.ts` (modify) | `loggable` appends the `request_id` |
| `supabase/functions/_shared/lib.test.ts` (modify) | Test for that |
| `supabase/functions/_shared/sync.ts`, `_shared/connections.ts`, `plaid-create-link-token/index.ts`, `plaid-exchange-token/index.ts` (modify) | Call `recordPlaidEvent` where Plaid errors are already caught |
| `supabase/functions/plaid-link-event/index.ts` (create) | Receives a Link exit from the app and records it |
| `apps/mobile/src/lib/link-log.ts` + `.test.ts` (create) | Pure: builds the exit body from the SDK's exit object |
| `apps/mobile/src/lib/plaid.ts` (modify) | Sends `link_session_id` with the exchange; reports exits |
| `CLAUDE.md`, `docs/ops/production.md` (modify) | Convention note; runbooks for reading the log and banning a user |

---

### Task 0: Branch and plan copy

- [ ] **Step 1:** `git checkout -b pedro-plaid-logging master` (the four modified `apps/mobile` files come along untouched; leave them).
- [ ] **Step 2:** Copy this plan to `docs/superpowers/plans/2026-10-07-plaid-logging.md` and commit only that file: `docs: plan for Plaid logging`.

---

### Task 1: `loggable` carries the request id

**Files:**
- Modify: `supabase/functions/_shared/lib.ts:103-112`
- Test: `supabase/functions/_shared/lib.test.ts`

**Interfaces:**
- Produces: `loggable(err: unknown): unknown`, same signature. For a Plaid error whose `response.data.request_id` is a non-empty string, the result ends with ` [request_id <id>]`. `describeError` is unchanged, because its text reaches the app's screen.

- [ ] **Step 1: Write the failing test.** In `lib.test.ts`, widen the helper's parameter type and add a test:

```ts
function plaidError(data?: { error_code?: string; error_message?: string; request_id?: string }) {
```

```ts
Deno.test('loggable appends the request id of a Plaid error', () => {
  const out = loggable(plaidError({ error_code: 'INVALID_FIELD', error_message: 'bad package name', request_id: 'abc123' }));
  assertEquals(out, 'INVALID_FIELD: bad package name [request_id abc123]');
  // No error_code: the axios message still gets the id.
  assertEquals(loggable(plaidError({ request_id: 'abc123' })), 'Request failed with status code 400 [request_id abc123]');
});
```

- [ ] **Step 2: Run it, expect FAIL.** `npx -y deno test --allow-env supabase/functions/_shared/lib.test.ts` fails on the new test (`INVALID_FIELD: bad package name` does not equal the expected text).

- [ ] **Step 3: Implement.** Replace `loggable` and its comment:

```ts
/**
 * What to log for a caught error. A Plaid SDK (axios) error carries its
 * request: the headers hold our Plaid secret and the body may hold a bank's
 * access token, so only Plaid's code, message and request_id are kept (the id
 * is what Plaid support asks for). Anything else is logged whole, stack
 * included.
 */
export function loggable(err: unknown): unknown {
  if (!(err as { isAxiosError?: boolean } | null)?.isAxiosError) return err;
  const requestId = (err as { response?: { data?: { request_id?: unknown } } }).response?.data?.request_id;
  const text = describeError(err);
  return typeof requestId === 'string' && requestId ? `${text} [request_id ${requestId}]` : text;
}
```

- [ ] **Step 4: Run it, expect PASS** (all tests in `lib.test.ts`, including the three existing ones).

- [ ] **Step 5: Commit** `lib.ts` and `lib.test.ts`: `feat: Plaid request id in error logs`.

---

### Task 2: The `plaid_events` table

**Files:**
- Create: `supabase/migrations/20261017120000_plaid_events.sql`

**Interfaces:**
- Produces: table `public.plaid_events` with columns `id, created_at, user_id, item_id, plaid_item_id, event, request_id, link_session_id, institution_id, link_status, error_type, error_code, error_message`. `event` is one of `link_token_failed | exchange_ok | exchange_failed | sync_failed | login_required | remove_failed | link_exit`.

- [ ] **Step 1: Write the migration.**

```sql
-- Plaid troubleshooting log. Plaid support and its Item Debugger ask for a
-- request_id, Plaid's item_id and Link's link_session_id; function logs on the
-- Free plan last about a day, so they are kept here instead.
--
-- Server-only: RLS on, no policies, no client grants. Rows are written by
-- recordPlaidEvent (_shared/plaid-log.ts) and read in the dashboard.
--
-- item_id is our plaid_items.id WITHOUT a foreign key, on purpose: "Delete
-- everything" removes the plaid_items row, and the log must outlive it.
-- plaid_item_id (Plaid's own id) is copied in for the same reason. user_id
-- does cascade: deleting an account deletes its log.
create table public.plaid_events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid references auth.users (id) on delete cascade,
  item_id         uuid,
  plaid_item_id   text,
  event           text not null check (event in (
    'link_token_failed', 'exchange_ok', 'exchange_failed',
    'sync_failed', 'login_required', 'remove_failed', 'link_exit'
  )),
  request_id      text,
  link_session_id text,
  institution_id  text,
  link_status     text,
  error_type      text,
  error_code      text,
  error_message   text
);
create index plaid_events_user_idx on public.plaid_events (user_id, created_at desc);
create index plaid_events_created_idx on public.plaid_events (created_at);
alter table public.plaid_events enable row level security;
revoke all on public.plaid_events from public, anon, authenticated;

-- Ninety days is longer than any support thread and short enough to stay small.
select cron.schedule(
  'plaid-events-prune',
  '20 4 * * *',
  $$delete from public.plaid_events where created_at < now() - interval '90 days'$$
);
```

- [ ] **Step 2: Push to dev.** `npx -y supabase@2.118.0 db push` (repo root). Expected: the one new migration applies.

- [ ] **Step 3: Verify the lock-down.**

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select has_table_privilege('authenticated','public.plaid_events','select') as auth_select, has_table_privilege('anon','public.plaid_events','insert') as anon_insert, (select relrowsecurity from pg_class where oid = 'public.plaid_events'::regclass) as rls, (select count(*) from cron.job where jobname = 'plaid-events-prune') as prune_jobs"
```

Expected: `f,f,t,1`.

- [ ] **Step 4:** `node scripts/rls-check.mjs`. Expected: passes as before (the migration touches grants).

- [ ] **Step 5: Commit** the migration: `feat: plaid_events table for Plaid troubleshooting`.

---

### Task 3: `_shared/plaid-log.ts`

**Files:**
- Create: `supabase/functions/_shared/plaid-log.ts`
- Test: `supabase/functions/_shared/plaid-log.test.ts`

**Interfaces:**
- Consumes: `loggable` from `./lib.ts`; table `plaid_events` (Task 2).
- Produces:
  - `type PlaidEventName = 'link_token_failed' | 'exchange_ok' | 'exchange_failed' | 'sync_failed' | 'login_required' | 'remove_failed' | 'link_exit'`
  - `type PlaidEvent = { event: PlaidEventName; user_id?: string | null; item_id?: string | null; plaid_item_id?: string | null; request_id?: string | null; link_session_id?: string | null; institution_id?: string | null; link_status?: string | null; error_type?: string | null; error_code?: string | null; error_message?: string | null }`
  - `clip(value: unknown, max: number): string | null`
  - `plaidErrorFields(err: unknown): Pick<PlaidEvent, 'request_id' | 'error_type' | 'error_code' | 'error_message'>`
  - `eventRow(event: PlaidEvent): Required<PlaidEvent>`
  - `linkExitEvent(body: unknown, userId: string): PlaidEvent | null`
  - `recordPlaidEvent(admin: SupabaseClient, event: PlaidEvent): Promise<void>` (never throws)
  - `LINK_EXITS_PER_HOUR = 30`

- [ ] **Step 1: Write the failing tests** (`plaid-log.test.ts`):

```ts
import { assertEquals } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { clip, eventRow, linkExitEvent, plaidErrorFields, recordPlaidEvent } from './plaid-log.ts';

/** Shaped like what the Plaid SDK throws: the request rides along. */
function plaidError(data?: Record<string, unknown>) {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    config: {
      headers: { 'PLAID-CLIENT-ID': 'client-id', 'PLAID-SECRET': 'plaid-secret' },
      data: '{"access_token":"access-token"}',
    },
    response: data ? { data } : undefined,
  });
}

/** Just enough of the client: a plaid_items lookup and a plaid_events insert. */
function fakeAdmin(opts: { item?: { plaid_item_id: string; user_id: string }; insertError?: string; throws?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      if (opts.throws) throw new Error('db down');
      if (table === 'plaid_items') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.item ?? null, error: null }) }) }) };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null });
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, inserted };
}

Deno.test('clip: a trimmed string cut to max; anything else is null', () => {
  assertEquals(clip('  abc  ', 10), 'abc');
  assertEquals(clip('abcdef', 3), 'abc');
  assertEquals(clip('   ', 10), null);
  assertEquals(clip(42, 10), null);
  assertEquals(clip({ a: 1 }, 10), null);
  assertEquals(clip(undefined, 10), null);
});

Deno.test('plaidErrorFields: reads Plaid error fields off response.data', () => {
  const out = plaidErrorFields(plaidError({
    error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details changed', request_id: 'req1',
  }));
  assertEquals(out, {
    request_id: 'req1', error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details changed',
  });
});

Deno.test('plaidErrorFields: never passes the request through', () => {
  for (const err of [plaidError(), plaidError({ error_code: 'INVALID_FIELD' })]) {
    const text = JSON.stringify(plaidErrorFields(err));
    assertEquals(text.includes('plaid-secret'), false);
    assertEquals(text.includes('access-token'), false);
  }
});

Deno.test('plaidErrorFields: any other error keeps only its message', () => {
  assertEquals(plaidErrorFields(new Error('boom')), {
    request_id: null, error_type: null, error_code: null, error_message: 'boom',
  });
  // A network failure: axios error with no response.
  assertEquals(plaidErrorFields(plaidError()).error_message, 'Request failed with status code 400');
  assertEquals(plaidErrorFields(null), { request_id: null, error_type: null, error_code: null, error_message: null });
  assertEquals(plaidErrorFields('text').error_message, null);
});

Deno.test('eventRow: every column present, long text clipped', () => {
  const row = eventRow({ event: 'sync_failed', user_id: 'u1', error_message: 'x'.repeat(10_000), request_id: 'r'.repeat(10_000) });
  assertEquals(row.event, 'sync_failed');
  assertEquals(row.user_id, 'u1');
  assertEquals(row.item_id, null);
  assertEquals(row.link_session_id, null);
  assertEquals(row.error_message!.length, 500);
  assertEquals(row.request_id!.length, 200);
});

Deno.test('linkExitEvent: reads the app body', () => {
  const item = '11111111-2222-3333-4444-555555555555';
  assertEquals(
    linkExitEvent({
      link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1', status: 'requires_credentials',
      error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password', item_id: item,
    }, 'u1'),
    {
      event: 'link_exit', user_id: 'u1', item_id: item, link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1',
      link_status: 'requires_credentials', error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password',
    },
  );
});

Deno.test('linkExitEvent: a broken or hostile body never throws', () => {
  assertEquals(linkExitEvent(null, 'u1'), null);
  assertEquals(linkExitEvent('text', 'u1'), null);
  assertEquals(linkExitEvent([1, 2], 'u1'), null);
  const out = linkExitEvent({ link_session_id: 7, item_id: 'not-a-uuid', error_message: 'x'.repeat(10_000), user_id: 'someone-else' }, 'u1')!;
  assertEquals(out.user_id, 'u1'); // never the body's
  assertEquals(out.item_id, null);
  assertEquals(out.link_session_id, null);
  assertEquals(out.error_message!.length, 500);
  // A plain cancel carries nothing but is still an exit.
  assertEquals(linkExitEvent({}, 'u1')!.event, 'link_exit');
});

Deno.test('recordPlaidEvent: inserts the row', async () => {
  const { admin, inserted } = fakeAdmin();
  await recordPlaidEvent(admin, { event: 'exchange_ok', user_id: 'u1', item_id: 'i1', plaid_item_id: 'p1', request_id: 'r1' });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].event, 'exchange_ok');
  assertEquals(inserted[0].plaid_item_id, 'p1');
});

Deno.test('recordPlaidEvent: fills Plaid item id and user from our item id', async () => {
  const { admin, inserted } = fakeAdmin({ item: { plaid_item_id: 'p9', user_id: 'u9' } });
  await recordPlaidEvent(admin, { event: 'remove_failed', item_id: 'i1' });
  assertEquals(inserted[0].plaid_item_id, 'p9');
  assertEquals(inserted[0].user_id, 'u9');
});

Deno.test('recordPlaidEvent: an Item that is already gone still gets a row', async () => {
  const { admin, inserted } = fakeAdmin();
  await recordPlaidEvent(admin, { event: 'sync_failed', user_id: 'u1', item_id: 'i1' });
  assertEquals(inserted[0].plaid_item_id, null);
  assertEquals(inserted[0].user_id, 'u1');
});

Deno.test('recordPlaidEvent: never throws, whatever the database does', async () => {
  await recordPlaidEvent(fakeAdmin({ insertError: 'relation does not exist' }).admin, { event: 'sync_failed' });
  await recordPlaidEvent(fakeAdmin({ throws: true }).admin, { event: 'sync_failed', item_id: 'i1' });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx -y deno test --allow-env supabase/functions/_shared/plaid-log.test.ts` fails: module not found.

- [ ] **Step 3: Implement** (`plaid-log.ts`):

```ts
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
```

- [ ] **Step 4: Run, expect PASS**, then the whole folder: `npx -y deno test --allow-env supabase/functions/_shared/`. Expected: everything passes.

- [ ] **Step 5: Commit** both files: `feat: recordPlaidEvent, the Plaid troubleshooting log`.

---

### Task 4: Record where Plaid errors are caught

**Files:**
- Modify: `supabase/functions/plaid-create-link-token/index.ts` (catch at line 91)
- Modify: `supabase/functions/plaid-exchange-token/index.ts` (body type; success before line 126; catch at line 127)
- Modify: `supabase/functions/_shared/sync.ts` (login-required branch near line 641; error branch near line 904)
- Modify: `supabase/functions/_shared/connections.ts` (itemRemove catch near line 102)

**Interfaces:**
- Consumes: `recordPlaidEvent(admin, event)`, `plaidErrorFields(err)` from `_shared/plaid-log.ts` (Task 3).
- Produces: `plaid-exchange-token` accepts an optional `link_session_id: string` in its body (Task 6 sends it).

No new unit tests: these are one-line calls to a helper that Task 3 pins, inside handlers with no test harness. Task 7 proves them end to end on dev. The existing suite must stay green; `recordPlaidEvent` never throws, so a test fake that lacks the table only warns.

- [ ] **Step 1: `plaid-create-link-token/index.ts`.** Add the import and extend the catch:

```ts
import { plaidErrorFields, recordPlaidEvent } from '../_shared/plaid-log.ts';
```

```ts
  } catch (err) {
    console.error('linkTokenCreate failed', loggable(err));
    // body.item_id passed the ownership check above, or is absent.
    await recordPlaidEvent(admin, { event: 'link_token_failed', user_id: user.id, item_id: body.item_id ?? null, ...plaidErrorFields(err) });
    return jsonResponse({ error: 'Failed to create link token' }, 500);
  }
```

- [ ] **Step 2: `plaid-exchange-token/index.ts`.** Add the same import. Add to `ExchangeBody`:

```ts
  /** Link's metadata.linkSessionId: Plaid support asks for it. */
  link_session_id?: string;
```

Replace step 4's tail (`return jsonResponse({ item_id: item.id });`) with:

```ts
    await recordPlaidEvent(admin, {
      event: 'exchange_ok',
      user_id: user.id,
      item_id: item.id,
      plaid_item_id: exchange.item_id,
      request_id: exchange.request_id,
      link_session_id: body.link_session_id,
      institution_id: body.institution_id,
    });

    return jsonResponse({ item_id: item.id });
```

and the catch with:

```ts
  } catch (err) {
    console.error('exchange-token failed', loggable(err));
    await recordPlaidEvent(admin, {
      event: 'exchange_failed',
      user_id: user.id,
      link_session_id: body.link_session_id,
      institution_id: body.institution_id,
      ...plaidErrorFields(err),
    });
    return jsonResponse({ error: 'Failed to connect bank' }, 500);
  }
```

(`eventRow` clips `link_session_id` and `institution_id`, so a non-string from the client becomes null.)

- [ ] **Step 3: `_shared/sync.ts`.** Add `import { plaidErrorFields, recordPlaidEvent } from './plaid-log.ts';`. In the `ITEM_LOGIN_REQUIRED` branch, after the status update and before `result = …`:

```ts
          await recordPlaidEvent(admin, { event: 'login_required', user_id: item.user_id, item_id: item.id, ...plaidErrorFields(err) });
```

In the outer catch, after the `console.error`:

```ts
      await recordPlaidEvent(admin, { event: 'sync_failed', user_id: item.user_id, item_id: item.id, ...plaidErrorFields(err) });
```

- [ ] **Step 4: `_shared/connections.ts`.** Add `import { plaidErrorFields, recordPlaidEvent } from './plaid-log.ts';`. In the `itemRemove` catch, inside `if (!isItemGone(err)) {`, after the `console.error`:

```ts
          // user_id and Plaid's item id are filled from the Item, which still exists here.
          await recordPlaidEvent(admin, { event: 'remove_failed', item_id: item.id, ...plaidErrorFields(err) });
```

- [ ] **Step 5: Run the suite.** `npx -y deno test --allow-env supabase/functions/_shared/`. Expected: all pass.

- [ ] **Step 6: Deploy to dev.** `npx -y supabase@2.118.0 functions deploy --use-api` (all functions: `sync.ts` and `connections.ts` are shared by several).

- [ ] **Step 7: Commit** the four files: `feat: record Plaid failures and new links in plaid_events`.

---

### Task 5: `plaid-link-event` function

**Files:**
- Create: `supabase/functions/plaid-link-event/index.ts`

**Interfaces:**
- Consumes: `linkExitEvent`, `recordPlaidEvent`, `LINK_EXITS_PER_HOUR` (Task 3); `corsHeaders, getAdminClient, getAuthedUser, jsonResponse, requireSecondStep` from `_shared/lib.ts`.
- Produces: `POST /functions/v1/plaid-link-event` with body `{ link_session_id?, request_id?, institution_id?, status?, error_type?, error_code?, error_message?, item_id? }` (all strings). Answers `200 { ok: true }`, `400 { error: 'Invalid body' }`, `401`, `403 two_factor_required`, `429 { error: 'too_many' }`.

JWT-verified by default: no `config.toml` entry.

- [ ] **Step 1: Write the function.**

```ts
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
```

- [ ] **Step 2: Deploy.** `npx -y supabase@2.118.0 functions deploy plaid-link-event --use-api`.

- [ ] **Step 3: Smoke test without a session.** PowerShell:

```powershell
$u = (Get-Content apps\mobile\.env | Select-String '^EXPO_PUBLIC_SUPABASE_URL=').Line.Split('=',2)[1]
try { Invoke-WebRequest -UseBasicParsing -Method Post "$u/functions/v1/plaid-link-event" -Body '{}' -ContentType 'application/json' } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `401`. (The signed-in cases run in Task 7.)

- [ ] **Step 4: Commit** the file: `feat: plaid-link-event, the app reports Link exits`.

---

### Task 6: The app reports Link exits

**Files:**
- Create: `apps/mobile/src/lib/link-log.ts`
- Test: `apps/mobile/src/lib/link-log.test.ts`
- Modify: `apps/mobile/src/lib/plaid.ts:53-96`

**Interfaces:**
- Consumes: function `plaid-link-event` (Task 5); `plaid-exchange-token`'s optional `link_session_id` (Task 4).
- Produces: `linkExitBody(exit: LinkExitLike, itemId?: string): LinkExitBody`.

The SDK's `LinkExit` (`node_modules/react-native-plaid-link-sdk/src/ReactNativePlaidLinkSdk.types.ts:452`) is `{ error?: { errorCode, errorType, errorMessage, displayMessage? }, metadata: { status?, institution?: { id, name }, linkSessionId, requestId } }`. `link-log.ts` declares its own structural type instead of importing the SDK, so `npm test` runs it under plain Node.

- [ ] **Step 1: Write the failing test** (`link-log.test.ts`):

```ts
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkExitBody } from './link-log.ts';

test('an exit with an error carries every identifier', () => {
  assert.deepEqual(
    linkExitBody({
      error: { errorCode: 'INVALID_CREDENTIALS', errorType: 'ITEM_ERROR', errorMessage: 'wrong password' },
      metadata: { status: 'requires_credentials', institution: { id: 'ins_1', name: 'Bank' }, linkSessionId: 'ls1', requestId: 'rq1' },
    }),
    {
      link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1', status: 'requires_credentials',
      error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password',
    },
  );
});

test('a plain cancel sends only what Link gave', () => {
  assert.deepEqual(linkExitBody({ metadata: { linkSessionId: 'ls1', requestId: '' } }), { link_session_id: 'ls1' });
});

test('update mode names the bank being repaired', () => {
  assert.deepEqual(linkExitBody({ metadata: { linkSessionId: 'ls1', requestId: 'rq1' } }, 'item-uuid'), {
    link_session_id: 'ls1', request_id: 'rq1', item_id: 'item-uuid',
  });
});

test('missing metadata or a null error never throws', () => {
  assert.deepEqual(linkExitBody({}), {});
  assert.deepEqual(linkExitBody({ error: null, metadata: null }), {});
});
```

- [ ] **Step 2: Run, expect FAIL.** In `apps/mobile`: `npm test`. Fails: cannot find `./link-log.ts`.

- [ ] **Step 3: Implement** (`link-log.ts`):

```ts
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
    institution?: { id?: string } | null;
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
```

- [ ] **Step 4: Run, expect PASS.** `npm test`.

- [ ] **Step 5: Wire `plaid.ts`.** Add `import { linkExitBody } from '@/lib/link-log';` with the other `@/lib` imports. In the exchange call's body, after `accounts: …`:

```ts
                  // Plaid support asks for it; the server keeps it with the new Item.
                  link_session_id: success.metadata.linkSessionId,
```

Replace `onExit`:

```ts
        onExit: (exit) => {
          // Fire and forget: a lost log line must never touch the Link flow.
          void supabase.functions
            .invoke('plaid-link-event', { body: linkExitBody(exit, itemId) })
            .catch(() => {});
          if (exit.error?.errorMessage) {
            setError(exit.error.errorMessage);
          }
          setIsConnecting(false);
        },
```

- [ ] **Step 6: Check.** In `apps/mobile`: `npm run typecheck`, then `npx expo lint`, then `npm test`. Expected: all clean. If `typecheck` rejects passing `exit` to `linkExitBody` (an SDK enum that is not string-valued), widen the matching field in `LinkExitLike` to `unknown` and keep the `typeof value === 'string'` filter; do not import the SDK into `link-log.ts`.

- [ ] **Step 7: Commit** the three files by explicit path: `feat: the app reports Link exits and the link session id`.

---

### Task 7: Prove it on dev, document, open the PR

**Files:**
- Modify: `CLAUDE.md` (Conventions), `docs/ops/production.md`
- Scratch (not committed): `<scratchpad>/link-event-check.mjs`

- [ ] **Step 1: Signed-in function cases.** Write this to the scratchpad and run `node <scratchpad>/link-event-check.mjs`. It acts as "Kel Test", the dev-only second test user:

```js
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('C:/dev/Tusky-App/apps/mobile/.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('ifibrsgqdibcomzxencf')) throw new Error('not the dev project: stop');

const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'ph.leao2099+tuskyherd@gmail.com', password: 'herd-test-9c-Tusky!' }),
}).then((r) => r.json());
if (!auth.access_token) throw new Error(`sign-in failed: ${JSON.stringify(auth)}`);

const call = async (label, body) => {
  const res = await fetch(`${url}/functions/v1/plaid-link-event`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${auth.access_token}`, 'content-type': 'application/json' },
    body,
  });
  console.log(label, res.status, await res.text());
};

await call('exit with error  ', JSON.stringify({ link_session_id: 'check-ls-1', request_id: 'check-rq-1', status: 'requires_credentials', error_code: 'INVALID_CREDENTIALS', error_type: 'ITEM_ERROR', error_message: 'check' }));
await call('not an object    ', '"text"');
await call('not json         ', 'nope');
// The test user's (ccbd42ef…) Item, not Kel Test's: must be dropped. Fill in an id from:
//   db query --linked -o csv "select id from plaid_items where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' limit 1"
await call('foreign item     ', JSON.stringify({ link_session_id: 'check-ls-2', item_id: process.argv[2] ?? '00000000-0000-0000-0000-000000000000' }));
```

Run it with the foreign Item id as the argument. Expected: `200`, `400`, `400`, `200`.

- [ ] **Step 2: Read the rows back.**

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select event, link_session_id, request_id, link_status, error_code, item_id, plaid_item_id from plaid_events where link_session_id like 'check-ls-%' order by id"
```

Expected: two rows. `check-ls-1` has `check-rq-1`, `requires_credentials`, `INVALID_CREDENTIALS`. `check-ls-2` has empty `item_id` and `plaid_item_id` (review focus 4). Then remove them: `… db query --linked "delete from plaid_events where link_session_id like 'check-ls-%'"`.

- [ ] **Step 3: One emulator pass** (Pixel_7, dev build, Metro fresh; `node scripts/emu.mjs ui` to navigate, no screenshots). As the test user:
  1. Start connecting a bank, then close Link with its X. Expect a `link_exit` row with a `link_session_id`.
  2. Connect First Platypus Bank (`ins_109508`, the plain entry) with `user_good` / `pass_good`. Expect an `exchange_ok` row with `plaid_item_id`, `request_id` and the same kind of `link_session_id`.
  3. On that bank's screen use the dev tool that forces a login reset, then pull to refresh on the Transactions tab (Home's refresh only refetches queries and never syncs), or use the webhook: the ITEM ERROR webhook that follows the reset now records the row itself. Expect a `login_required` row with `error_code = ITEM_LOGIN_REQUIRED` and a `request_id`.
  4. Disconnect the bank ("Delete everything"). The three rows must still be there, with `plaid_item_id` kept.

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select event, error_code, request_id is not null as has_request, link_session_id is not null as has_session, plaid_item_id is not null as has_plaid_item, created_at from plaid_events where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' order by id desc limit 6"
```

  Then `node scripts/emu.mjs logs`: no new JS errors.

- [ ] **Step 4: `CLAUDE.md`.** Add under Conventions, after the "Never log a caught Plaid error whole" gotcha's sibling conventions (next to the `plaid-webhook` bullet):

```markdown
- **Plaid troubleshooting log** (`plaid_events`, server-only). Plaid support asks for a `request_id`,
  Plaid's `item_id` and Link's `link_session_id`, and Free-plan function logs last about a day, so
  they are kept in a table: 90 days (pg_cron `plaid-events-prune`), deleted with the user. Every write
  goes through `recordPlaidEvent` (`_shared/plaid-log.ts`), which never throws: a lost log row must
  never fail a sync, a link or a disconnect. `plaidErrorFields` reads only `response.data` and the
  message, never the request. `item_id` has no foreign key on purpose, so the log outlives a deleted
  bank. The app reports Link exits to `plaid-link-event` (30 per user per hour) and sends
  `link_session_id` with the token exchange. A new Plaid call that can fail should record an event.
```

- [ ] **Step 5: `docs/ops/production.md`.** Add two sections before "Known issues":

```markdown
## Reading the Plaid log

Dashboard → Table editor → `plaid_events`, newest first, or SQL:

    select created_at, event, error_code, error_message, request_id, plaid_item_id, link_session_id
    from plaid_events where user_id = '<user id>' order by id desc limit 20;

For a Plaid support ticket give `request_id`, `plaid_item_id` (their item_id) and, for a failed
connection, `link_session_id`. Plaid's Item Debugger takes the same item_id. Rows last 90 days.
Function logs (Edge Functions → Logs) carry the same request ids but only for about a day on the
Free plan.

## Suspending a user

Dashboard → Authentication → Users → the user's menu → **Ban user**, with a duration. A banned user
cannot sign in or refresh a session; a session already open ends when its token expires, within the
hour. Lift it from the same menu.

What a ban does NOT do: their banks keep syncing through Plaid's webhooks, Plaid keeps billing for
them, and a store subscription keeps renewing. Stopping those needs code that does not exist yet
(a server-side suspend that removes their Items at Plaid). Until then, for abuse that costs money,
ask Pedro before touching their banks by hand.
```

- [ ] **Step 6: Commit** the two docs: `docs: Plaid log and user suspension runbooks`.

- [ ] **Step 7: Push and open the PR** (`gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro-plaid-logging --body-file <scratchpad>/pr.md`). Body: what the table holds, where rows come from, the 90-day prune, that production needs the migration and a deploy of all functions, and the test evidence from Steps 1–3. Do not merge.

- [ ] **Step 8: Production, only on Pedro's go-ahead, one command at a time** (after the PR merges): follow `docs/ops/production.md` for the migration push and the function deploy to `awiwcgrisyzimzxgddxu`, showing each exact command first. The app half ships with the next store build; until then production records server events only. Then Pedro marks **Logging** complete in the Plaid dashboard.

---

## Verification (whole branch)

- `npx -y deno test --allow-env supabase/functions/_shared/` passes.
- In `apps/mobile`: `npm run typecheck`, `npx expo lint`, `npm test` pass.
- `node scripts/rls-check.mjs` passes.
- Task 2 Step 3 prints `f,f,t,1`.
- Task 7 Steps 1–3 show the expected rows on dev.

## Out of scope

- A server-side suspend (stopping syncs and Plaid billing for a user). Runbook only, by decision.
- A custom admin dashboard. The Supabase dashboard covers reading the log and banning.
- Recording every successful Plaid call. Only new links and failures are kept.
- The privacy policy. It may deserve one line saying Tusky keeps technical error records for up to 90 days; raise it with Pedro after this ships.
- The Android OAuth white screen (`docs/ops/production.md`, Known issues). Separate investigation; this log will help it, since a failed OAuth return now leaves either a `link_exit` row or none at all.
