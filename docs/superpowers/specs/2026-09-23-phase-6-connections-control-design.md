# Phase 6 — Connections & control (design)

Status: approved 2026-09-23 and **not started**. Build it in a later session: write the implementation plan
(`superpowers:writing-plans`) from this spec at that point, so the plan matches the code as it is then.

Phase 6 gives users control over their connected banks:

- disconnecting a bank for real;
- hiding and unhiding accounts;
- blocking duplicate connections;
- closing the database grants the app never needed.

Its last step is the pending switch to Kelvyn's Plaid keys, and that step waits for Pedro's go-ahead.
Brainstorming settled the scope:

- **Disconnect** asks the user whether to keep history (the default) or delete everything.
- **Category groups** move to a later categories phase (see Deferred).
- **Duplicates** are blocked before the token exchange.
- **The key switch** comes last.

## What the code and database show (2026-09-23)

- **Disconnecting a bank is impossible.**
  - Nothing calls Plaid's `/item/remove`, and Plaid bills every Item monthly until it is called
    (`docs/product/monetization.md`).
  - That document already describes the archive path this spec builds: remove the Item at Plaid,
    delete the token, and keep the `plaid_items` row as `archived` so its history survives.
- **`accounts.hidden` has no UI.**
  - Every read path already honours it:
    - the feed, via `accounts!inner(hidden)`;
    - `monthly_category_totals`;
    - `daily_net_worth`;
    - `useRecurringStreams`.
  - `grant update (hidden)` exists. Nothing in the app can set it.
- **Duplicate connections exist.**
  - The test user has two Chase Items, linked 09-20 and 09-23, each with 14 accounts. Chase therefore
    counts twice in their net worth and feed.
  - `plaid-exchange-token` accepts any successful Link. In production every duplicate is a separately
    billed Item.
- **The grants are wider open than the Phase 5 handoff said.**
  - `pg_class.relacl` shows `anon` and `authenticated` holding `arwdDxtm` on all seven older tables
    (`plaid_items`, `accounts`, `categories`, `plaid_category_map`, `transactions`, `budgets`,
    `balance_snapshots`) and on both views. `arwdDxtm` is every privilege, TRUNCATE included.
  - RLS still keeps users out of each other's rows. But `transactions` and `accounts` have UPDATE
    policies, so a signed-in user can rewrite any column of their own rows (amount, date, balance,
    type). The column grants (`update (category_id, category_is_manual)`, `update (hidden)`) restrict
    nothing.
  - The default privileges for role `postgres` in schema `public` grant the same to every new table,
    sequence and function.
  - `supabase/config.toml` (`auto_expose_new_tables`) says new cloud projects no longer auto-expose new
    objects, and that the legacy behaviour ends on 2026-10-30. This project predates that and still
    has it.
  - `recurring_streams` (Phase 5) and `plaid_tokens` are already correct.
- **The Plaid key switch is pending.**
  - Kelvyn's Sandbox keys are in `supabase/functions/.env`, not pushed.
  - Four Items exist, all `active`: the test user's three, plus a Chase owned by user
    `33c789b7-d651-43c2-a265-d2b7d86f5580`.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Disconnect | The prompt offers **Keep history** (the default) or **Delete everything**. Both remove the Item at Plaid first | Chosen. Only `/item/remove` stops billing |
| Kept (archived) bank | `status = 'archived'`. Token deleted; accounts, transactions and past snapshots kept. Leaves Home, net worth from that day on, snapshots, syncs and recurring. **Delete history** removes it later | History stays readable, and nothing frozen pretends to be live |
| Plaid failure | Local state changes only if `/item/remove` succeeds or returns `ITEM_NOT_FOUND`. Anything else returns 502 and changes nothing | The token is the only way to stop billing. Deleting it after a transient error would leak a billed Item forever |
| Concurrency | Disconnect takes the same `sync_locked_at` claim as `syncItem`. If a sync holds it, return 409 | A sync finishing after an archive would write rows and set `status: 'active'` again |
| Duplicates | Checked **before** the exchange. A duplicate is the same `institution_id` plus an account with the same name and mask on one of the user's `active`/`login_required` Items. If Link sends no masks, the same institution alone counts. Archived Items never block | Plaid's guidance: "Do not exchange a public token for an access token if you detect a duplicate Item," comparing institution id, account name and mask. If archived Items blocked, "Keep history" would lock the user out of that bank |
| Hide/unhide | New `/bank/[id]` screen, opened from Settings and from Home's account rows, with a switch per account | It is the only place that lists hidden accounts, so they can be unhidden |
| Grants | Revoke everything on the nine older relations, re-grant exactly what the app uses, and revoke `postgres`'s default privileges in `public` | Fails closed. Matches Supabase's new default |
| Key switch | Last step, gated on Pedro's go-ahead | Old Items must be removed while the old keys still work: an access token only works with the Plaid account that issued it |

## Storage

### `<ts>_phase6_item_status.sql`

```sql
alter table public.plaid_items
  add constraint plaid_items_status_check check (status in ('active', 'login_required', 'archived'));
comment on column public.plaid_items.status is 'active | login_required | archived';
```

All four current rows are `active`. The old inline comment listed `disconnected`, which nothing ever
wrote.

### `<ts+1>_phase6_revoke_default_grants.sql`

Follow the pattern of `20260923181000_recurring_streams_revoke_defaults.sql`: revoke everything, then
grant back exactly what the app uses. Every `supabase.from(` in `apps/mobile` was checked for this.

```sql
revoke all on table
  public.plaid_items, public.accounts, public.categories, public.plaid_category_map,
  public.transactions, public.budgets, public.balance_snapshots,
  public.monthly_category_totals, public.daily_net_worth
from anon, authenticated;

grant select on public.plaid_items, public.accounts, public.categories, public.transactions,
  public.balance_snapshots, public.monthly_category_totals, public.daily_net_worth to authenticated;
grant update (hidden) on public.accounts to authenticated;
grant update (category_id, category_is_manual) on public.transactions to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
```

- **Column grants and REVOKE.** A table-level REVOKE also revokes that table's column privileges.
  That is why the column grants are re-issued after the revoke.
- **`balance_snapshots`.** The app never reads it directly, but `daily_net_worth` is
  `security_invoker`, so it needs the caller to hold `select` on its base tables.
- **`budgets`** keeps full DML, as before. Its RLS with-check pins `user_id`, and none of its columns
  are server-owned.
- **`plaid_category_map`** gets nothing. Only the service role reads it (`loadSyncContext`), and the
  app never does.
- **Functions** also get `EXECUTE` from PUBLIC by Postgres default, not only through these grants. No
  RPC functions exist yet. Revisit this when the first one is added.
- **`supabase_admin`'s defaults** are left alone. Migrations run as `postgres`.

## Server

### `supabase/functions/_shared/connections.ts` (new, Deno-tested)

**Pure, so the decisions are pinned by tests:**

- **`planDisconnect(status, mode)`** returns one of `'noop' | 'delete_local' | 'remove_then_archive' |
  'remove_then_delete'`:
  - `active` or `login_required` with `archive` → `remove_then_archive`. A broken Item can still be
    removed at Plaid.
  - `active` or `login_required` with `delete` → `remove_then_delete`.
  - `archived` with `delete` → `delete_local`. Its token is already gone, so there is no Plaid call.
  - `archived` with `archive` → `noop`.
  - Any other status → throws. The check constraint makes that unreachable, so failing loudly is
    right.
- **`isItemGone(err)`** is true only for `response.data.error_code === 'ITEM_NOT_FOUND'`, the shape
  `describeError` in `sync.ts` reads. Plaid documents that code for an Item that "has been
  previously removed via /item/remove, or has had access removed by the user".
- **`isDuplicateLink(existing, incoming)`**:
  - True when an incoming account's mask and name (trimmed, case-folded) equal an existing account's.
  - Also true when no incoming account has a mask and `existing` is non-empty. This is Plaid's
    fallback: same institution, same user.

**I/O:**

`disconnectItem(admin, plaid, item, mode)` returns `'ok' | 'busy' | 'plaid_failed'`:

1. **Claim.** Use the same atomic update as `syncItem`: `sync_locked_at` null or older than the
   5-minute stale window, plus `status in ('active','login_required')`. If no row comes back, return
   `busy`.
2. **Remove at Plaid.**
   - Read the token. If it is missing, skip Plaid: an earlier attempt already removed the Item and
     deleted the token.
   - Otherwise call `plaid.itemRemove({ access_token })`.
   - On an error that `isItemGone` rejects, release the claim and return `plaid_failed`.
3. **Delete** (`remove_then_delete`, `delete_local`): delete the `plaid_items` row. The cascade
   covers `plaid_tokens`, `accounts`, and through them `transactions`, `balance_snapshots` and
   `recurring_streams`.
4. **Archive** (`remove_then_archive`), in this order:
   - Delete the `plaid_tokens` row.
   - Delete the Item's `recurring_streams`, dismissed or not, scoped by its account ids as
     `refreshRecurring` does. An archived Item never re-detects, so a dismissal has nothing left to
     protect.
   - Delete its `balance_snapshots` dated today (UTC, the snapshot clock). The chart's last point then
     equals Home's hero.
   - Last, set `status = 'archived'`, `sync_cursor = null` and `sync_locked_at = null`. A crash
     before this point leaves a retryable Item: the next attempt finds no token or gets
     `ITEM_NOT_FOUND`, and continues.

### `supabase/functions/plaid-disconnect-item/index.ts` (new)

JWT is verified by default (no `config.toml` entry). Shaped like `plaid-sandbox/index.ts`, with the
helpers from `_shared/lib.ts`.

`POST { item_id, mode: 'archive' | 'delete' }` responds:

| Status | Case |
| --- | --- |
| 400 | Missing or invalid body |
| 401 | No authenticated user |
| 404 | The Item is not the caller's |
| 409 | `busy`: "This bank is syncing — try again in a moment." |
| 502 | `plaid_failed`: "Plaid couldn't remove the connection; nothing was changed." |
| 500 | A database error, logged |
| 200 | `{ ok: true }` |

### Changes to existing code

**`_shared/sync.ts`**
- The claim adds `.in('status', ['active', 'login_required'])`, so an archived Item can never be
  claimed, whatever list a caller loaded.
- The snapshot query selects `id, current_balance, plaid_items(status)` and maps each row to
  `archived: status === 'archived'`.

**`_shared/accounts.ts`**
- `AccountRow` gains `archived?: boolean`, and `buildSnapshotRows` skips archived rows.
- An archived bank's accounts stop being carried forward. Its past snapshots remain.

**`plaid-exchange-token`**
- The body gains `accounts?: { name?: string; mask?: string }[]` from Link's `metadata.accounts`
  (`LinkAccount.name`/`mask` in `react-native-plaid-link-sdk`).
- Before `itemPublicTokenExchange`:
  - Load the user's accounts on Items with that `institution_id` and status `active` or
    `login_required`: select `accounts` with `plaid_items!inner(institution_id, status)`.
  - If `isDuplicateLink` matches, log it and return 409 `{ error: 'duplicate' }`. Don't exchange, so
    no access token is ever created.
  - With no `institution_id` in the body there is nothing to compare, so skip the check.

**Unchanged:** `plaid-webhook` and `plaid-sync-transactions` already select only
`active`/`login_required` Items.

## Client

### `lib/queries.ts`

- `PlaidItem` gains `created_at`, and `status` becomes `'active' | 'login_required' | 'archived'`.
- `useAccounts` (Home only) excludes archived banks' accounts in SQL. It uses
  `plaid_items!inner(status)` with `.neq('plaid_items.status', 'archived')`, the same idiom as
  `accounts!inner(hidden)`. Home's hero therefore never flickers while items load.
- New `useItemAccounts(itemId)`:
  - Keyed `['accounts', itemId]`.
  - Returns every account of that Item, hidden ones included.
  - Invalidating `['accounts']` also covers it, because query keys match by prefix.
- New `useSetAccountHidden()`:
  - Updates `['accounts', itemId]` optimistically.
  - Then invalidates `['accounts']`, `['transactions']`, `['reports']`, `['net_worth']` and
    `['recurring']`. That is the list the Phase 5 handoff required of any hide toggle.

### `lib/plaid.ts`

- New `useDisconnectBank()` returns `{ disconnect(itemId, mode), isDisconnecting, error }`. It calls
  `plaid-disconnect-item`, then invalidates `['plaid_items']` and the five keys above.
- `useConnectBank`:
  - Sends `accounts: success.metadata.accounts.map(({ name, mask }) => ({ name, mask }))` with the
    exchange.
  - On a 409 `duplicate`, shows: "{Institution} is already connected. If it stopped syncing, use
    Reconnect in Settings."
- Move the FunctionsHttpError body parsing, now inline in `useSyncTransactions`, into one helper
  shared by sync, connect and disconnect.

### `app/bank/[id].tsx` (new)

Register `<Stack.Screen name="bank/[id]" options={{ headerShown: true }} />` in `app/_layout.tsx`, next
to `recurring`, inside the session-protected group.

- **Title:** the institution name.
- **Status line:**

  | Status | Line |
  | --- | --- |
  | `active` | "Syncing automatically · connected Sep 20" |
  | `login_required` | "Sign-in expired", with a Reconnect button (update mode, as today) |
  | `archived` | "Disconnected · history kept" |

- **Accounts:**
  - One row per account: name, mask and subtype, balance through `Amount`, and a `Switch` labelled
    "Show in Tusky" whose value is `!hidden`.
  - Archived banks show balances dimmed, because they are not counted.
  - Caption: "Hidden accounts leave net worth, transactions, budgets, reports and bills. Nothing is
    deleted."
- **`__DEV__` tools:** Webhook (dev) and Break (dev), moved here from Settings, for non-archived banks
  only.
- **Disconnect bank:**
  - Opens `Alert`: "Disconnect {Institution}?" / "Tusky stops syncing it and removes the connection
    at Plaid."
  - The buttons are Cancel, Delete everything and **Keep history**. Keep history comes last, so it is
    Android's positive button.
  - **Delete everything** asks a second time and names the loss: "Deletes its N accounts and all
    their transactions. This can't be undone."
- **Archived banks** show **Delete history** instead, with one confirmation.
- **After success,** call `router.back()`.

Before writing this screen, read the Expo SDK 57 docs for `useLocalSearchParams` and per-screen
`Stack.Screen` options, per `apps/mobile/AGENTS.md`.

### Settings, Home, account rows

**`app/(tabs)/settings.tsx`**
- Live banks (`active`, `login_required`) become rows with a chevron to `/bank/[id]`.
- Reconnect stays inline for `login_required`. Today any status other than `active` reads "Sign-in
  expired", which would mislabel an archived bank.
- Archived banks are listed under a **Disconnected** heading.
- The "Connect a bank" / "Connect another bank" label counts live banks only.

**`components/account-row.tsx`**
- Gains optional `onPress` and `trailing` props.
- Home's rows push `{ pathname: '/bank/[id]', params: { id: account.item_id } }`.

All text goes through `AppText`, all money through `Amount`, and all colours and spacing through
`constants/theme.ts`.

## Known and accepted

- **Reconnecting a kept bank.**
  - Reconnecting a bank whose history was kept creates a new connection. Its first 90 days overlap
    the kept history and show twice until the old one is deleted.
  - The duplicate guard ignores archived Items on purpose.
- **Net worth steps on the disconnect day.** Kept history still counts on earlier days, so the line
  jumps on that day.
- **Plaid failures.**
  - Any failure other than `ITEM_NOT_FOUND` leaves the bank connected, and the user retries.
  - An Item whose token died another way cannot be removed from the app. Examples: keys switched
    without disconnecting first, or the wrong `PLAID_ENV`. That is an ops cleanup, not a user action.
- **OAuth banks.** For Chase, PNC, Navy Federal and Schwab, Plaid warns that a second OAuth link with
  the same credentials can invalidate the existing Item, even though we refuse the duplicate. The
  message's pointer to Reconnect (update mode) is the repair.
- **Client-side metadata.** The duplicate check trusts Link's metadata as the client sends it.
  Bypassing it only duplicates the caller's own data. A bank-count tier limit in
  `plaid-exchange-token` is the real server-side cap (monetization).
- **No idle-bank auto-archive yet.** When the free tier needs it, it calls `disconnectItem(…,
  'archive')`.
- **No tests for the new client code.** `apps/mobile` still has no test runner, so the new client
  code is verified on the emulator, as in Phase 5.

## Deferred

- **Category groups → a categories phase.**
  - Done Monarch's way, today's 16 categories become groups over about 50 finer categories from
    Plaid's detailed codes (Groceries, Restaurants, Coffee…).
  - `transactions.pfc_detailed` is already stored on every row, so a backfill needs no re-sync. It
    must skip `category_is_manual` rows.
  - It also needs a two-level picker, plus budgets and reports by group.
  - It pairs naturally with custom categories, auto-rules and merchant renaming.
- **Idle-bank auto-archive** and every tier limit belong to the monetization phase.
- **Plaid limited Production** (up to 10 Items on Kelvyn's account) is a later decision. `/item/remove`
  is what frees a slot.

## Verification (build session)

- **Driving the emulator:** use `node scripts/emu.mjs` (see CLAUDE.md).
- **SQL:** `npx supabase db query --linked`, keyed on `user_id`, never joining `auth.users`.

1. **Unit tests and lint.**
   - Run `npx -y deno test supabase/functions/_shared/`: the 54 existing tests plus about 17 new.
   - The new tests cover:
     - `planDisconnect`: its five cases and the throw.
     - `isItemGone`: `ITEM_NOT_FOUND` versus `ITEM_LOGIN_REQUIRED`, `INVALID_ACCESS_TOKEN`, and a
       network error with no response.
     - `isDuplicateLink`: match; same mask with a different name; different masks; case and space
       folding; no incoming masks; no live Items.
     - `buildSnapshotRows`: skips archived accounts.
   - Then, in `apps/mobile`, run `npm run typecheck && npx expo lint`.
2. **Grants.**
   - Re-run the ACL query below. `anon` must appear nowhere in `public`, and `authenticated` only as
     granted. The `postgres in public` default entries must list only `postgres` and `service_role`.
   - `has_column_privilege('authenticated', 'public.transactions', 'amount', 'UPDATE')` must be false,
     and the same check on `category_id` true.
   - An anon `GET /rest/v1/transactions` must return 401 `42501`.
   - Emulator regression pass: feed, recategorize, budget set and delete, reports, the net worth chart,
     recurring dismiss and restore.
3. **Hide/unhide.**
   - Hiding a Chase account removes it from Home, the feed, reports, the chart and bills.
   - Unhiding it restores all of them.
4. **Duplicate guard.**
   - Connect another bank → First Platypus (`user_transactions_dynamic`).
   - Expect "already connected" and no new `plaid_items` row.
5. **Delete everything** on the duplicate Chase (linked 09-23; Settings lists Items oldest first).
   - Its 14 accounts and 48 transactions are gone.
   - Chase stops counting twice.
   - `/item/remove` works on the emulator, because no Link is involved.
6. **Keep history** on First Platypus.
   - `status = 'archived'` and the `plaid_tokens` row is gone.
   - Its 331 transactions remain in the feed and reports.
   - Its 7 accounts leave Home.
   - Today's snapshot rows for them are gone, so the chart's last point equals the hero.
   - Its streams are gone.
   - A sync's results omit it.
   - Settings lists it under Disconnected.

The ACL query used for the findings above:

```sql
select c.relname, c.relkind, c.relacl::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m') order by 1;
select pg_get_userbyid(defaclrole), defaclnamespace::regnamespace, defaclobjtype, defaclacl::text from pg_default_acl;
```

## Final step: the Plaid key switch (only on Pedro's go-ahead)

1. **Delete the old Chase.** Run **Delete everything** on the original Chase (linked 09-20) while the
   old keys still work.
2. **The other user's Chase (`33c789b7-…`) needs Pedro's decision.** Either its owner disconnects it in
   the app before the switch, or Pedro approves deleting its rows by SQL afterwards. It is a Sandbox
   Item, so nothing bills.
3. **Kelvyn's Plaid dashboard.** Add `com.tusky.app` under Allowed Android package names, or native
   Link refuses to open.
4. **Push the keys.** Run `npx supabase secrets set --env-file supabase/functions/.env`, and only at
   this step. `PLAID_ENV` stays `sandbox`.
5. **Relink First Platypus** on the emulator.
   - It must be allowed despite the archived Platypus, which proves archived Items don't block.
   - Then run **Delete history** on the archived one. That is the `delete_local` path, with no Plaid
     call.
6. **Relink Chase on a phone.** It is OAuth, so it needs the phone and an arm64 build. Sync, then fire
   a dev webhook to confirm verification and background sync work under the new client.
7. **Record the switch.** Note it in the handoff and project memory. The `--env-file` warning is then
   retired.

## Test data (2026-09-23)

| User | Item | Linked | Accounts | Transactions |
| --- | --- | --- | --- | --- |
| test user `ccbd42ef-…` | Chase (OAuth) | 09-20 | 14 | 52 |
| test user | Chase (duplicate) | 09-23 | 14 | 48 |
| test user | First Platypus Bank (`user_transactions_dynamic`) | 09-23 | 7 | 331 |
| `33c789b7-…` | Chase | 09-22 | 14 | 48 |
