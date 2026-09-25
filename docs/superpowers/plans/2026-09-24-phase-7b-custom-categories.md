# Phase 7b — Custom Categories and Built-in Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can rename, recolour and hide the built-in categories, and add their own categories under any group, with deletes that move a category's transactions to its group.

**Architecture:**
- **Database.** One migration adds `category_overrides` (per-user name, colour and hidden flag for built-ins) and lets clients insert and edit their own `categories` rows through column grants. A `user_categories` view merges built-ins, the user's custom rows and their overrides.
- **Server.** A JWT-verified `delete-category` function moves a custom category's transactions, streams and budget, then deletes the row. Its checks are pure and Deno-tested. Sync stops loading every user's categories.
- **App.** `useCategories` reads the view. `lib/categories.ts` gains pure helpers for hiding, names and override patches. A new `/categories` screen, reached from Settings, edits everything through one bottom sheet.

**Tech Stack:** Supabase Postgres (RLS, column grants, `security_invoker` view); Deno Edge Functions; Expo SDK 57 / expo-router 57; React Query 5; `node --test` for app logic.

**Spec:** `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md` (Milestone 7b), plus "What 7b needs" in `docs/superpowers/plans/2026-09-24-phase-7a-handoff.md`.

## Global Constraints

- **Built-in ids and slugs never change.** Renames, recolours and hides are per-user overrides, never new rows: community categorization needs one shared vocabulary.
- **Custom categories sit under a built-in group only.** No custom groups. `categories_enforce_tree` already pins the parent and copies its `kind`.
- **Clients never write `parent_id` after insert, and never write `kind`, `slug` or `user_id`.** The grants are exactly `insert (name, parent_id, icon, color)` and `update (name, icon, color)`.
- **No client delete on `categories`.** Deletes go through `delete-category`, which is JWT-verified by default: add no `config.toml` entry.
- **Grants fail closed.**
  - `category_overrides`: `select, insert, update, delete` to authenticated.
  - `user_categories`: `select` to authenticated.
  - Nothing to anon.
- **Views** use `with (security_invoker = on)`, plus a redundant `(select auth.uid())` predicate (CLAUDE.md).
- **Names** are 1–40 characters after trimming. **Colours** match `^#[0-9A-Fa-f]{6}$`. The database checks both, and the app pre-checks names.
- **Never rewrite a manual choice.** A delete moves transactions to the group and leaves `category_is_manual` as it is.
- **Hidden means out of the way, not gone.** A hidden category leaves the picker (unless it is the current selection) and Budgets' discovery rows. Its transactions, budget and Reports spend all stay.
- **UI conventions.** Amounts through `Amount`, text through `AppText`, colours and spacing only from `constants/theme.ts`. Category colours are data.
- **Expo SDK 57; no new native modules** (no rebuild).
- **Git.** Work on `pedro-7b`, which is stacked on PR #6 (`pedro`). Never merge. Never `supabase secrets set --env-file`.
- **Deploy order.** Push the migration before deploying the functions.

## Review Focus

1. **The current category is hidden** (a transaction's category, or its group, hidden after the fact). The picker must still list it, checked, under its group. Test: `pickerSections` / `withoutHidden` with a hidden selection (Task 3).
2. **Hiding a group.** Its children leave the picker and Budgets' discovery rows, but a budget on the group or a child still shows, and Reports still counts the spend. Test: `withoutHidden` (Task 3). Budgets keeps `groupById` unfiltered (Task 4).
3. **Names that are blank, padded or too long.** "   " is refused, "  Date night " is stored trimmed, and 41 characters are refused, the same in the app and the database. Test: `validateCategoryName` (Task 3), plus the SQL constraint check (Task 1).
4. **Someone else's category, or a built-in, sent to `delete-category`.** Answered 404, and nothing changes. Test: `planCategoryDelete` (Task 2), plus curl with a real JWT (Task 2).
5. **Deleting a category that has manual transactions and a budget.** The transactions move to the group and stay manual, the budget goes, and a later sync does not bring the category back. A custom **transfer** category stays out of recurring detection. Test: `ignoredCategoryIds` with a slug-less custom transfer (Task 2), plus the SQL checks after the emulator delete (Task 6).

## Deviations from the spec

- **No delete policy on `categories`.** The spec lists one, but it also gives clients no delete grant, so the policy would be dead config. `delete-category` uses the service role.
- **The view gains `overridden`** (does this user have an override row?), so the sheet knows when "Reset to default" applies.
- **Isolation is tested in SQL, with a simulated second user.** `set local role authenticated`, plus `request.jwt.claims` for the other user's id, in a statement that rolls back. The spec says "a user JWT". This exercises the same RLS path without touching the other user's data. The real-JWT check is `delete-category`'s 404s.
- **Sync loads custom transfers per Item** (the 7a handoff item). `loadSyncContext` keeps built-ins only.

---

### Task 1: Migration — overrides, custom rows, the `user_categories` view

**Files:**
- Create: `supabase/migrations/20260924210000_phase7b_custom_categories.sql`

**Interfaces:**
- Produces:
  - `category_overrides(user_id, category_id, name, color, hidden, updated_at)`, with primary key `(user_id, category_id)`.
  - `user_categories(id, slug, parent_id, kind, icon, sort_order, name, color, hidden, is_custom, overridden)`.
  - Client insert and update on `categories`, through column grants.

- [ ] **Step 1: Baseline** (repo root). Record it in the ledger.

```sh
npx --no-install supabase db query --linked -o csv "select count(*) manual_rows, md5(string_agg(id::text || ':' || category_id::text, ',' order by id)) manual_checksum from transactions where category_is_manual"
npx --no-install supabase db query --linked -o csv "select count(*) filter (where length(btrim(name)) not between 1 and 40) bad_names, count(*) filter (where color !~ '^#[0-9A-Fa-f]{6}$') bad_colors, count(*) total from categories"
```

Expected: `bad_names=0, bad_colors=0, total=77`. If either is non-zero, the new constraints would fail the migration: fix the data first, and ledger a ruling.

- [ ] **Step 2: Write the migration**

```sql
-- Phase 7b: users rename, recolour and hide built-in categories (per-user
-- overrides, never new rows, so every label stays in one shared vocabulary)
-- and add their own under any built-in group. See
-- docs/superpowers/specs/2026-09-24-phase-7-categories-design.md (Milestone 7b).

-- Custom rows sort after their group's built-in children. Every seed names its
-- own sort_order, so only client inserts take this default.
alter table public.categories alter column sort_order set default 1000;

alter table public.categories
  add constraint categories_name_length check (length(btrim(name)) between 1 and 40),
  add constraint categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');

-- A custom category belongs to its creator (user_id defaults to auth.uid())
-- and is a child: categories_enforce_tree pins its parent to a built-in group
-- and copies the group's kind, which is why a client never names kind.
create policy "Users add their own categories"
  on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()) and parent_id is not null);

create policy "Users edit their own categories"
  on public.categories for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Exactly what the app writes. No client delete: delete-category moves a
-- category's transactions, streams and budget first. parent_id is insert-only,
-- because the tree trigger cannot stop a childless group being made its own
-- parent; the only guard is that no client can write parent_id on update.
grant insert (name, parent_id, icon, color) on public.categories to authenticated;
grant update (name, icon, color) on public.categories to authenticated;

-- Per-user changes to a built-in. A null name or colour means "the built-in's".
-- Client-owned end to end, like budgets.
create table public.category_overrides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table public.category_overrides enable row level security;

create trigger category_overrides_updated_at
  before update on public.category_overrides
  for each row execute function public.set_updated_at();

-- Only built-ins take overrides: a custom row is edited directly. Runs as the
-- caller, so another user's custom row is invisible here and refused too.
create function public.category_overrides_builtin_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id is null
  ) then
    raise exception 'only built-in categories take overrides';
  end if;
  return new;
end;
$$;

create trigger category_overrides_builtin_only
  before insert or update of category_id on public.category_overrides
  for each row execute function public.category_overrides_builtin_only();

create policy "Users see their own category overrides"
  on public.category_overrides for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users add their own category overrides"
  on public.category_overrides for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users change their own category overrides"
  on public.category_overrides for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users remove their own category overrides"
  on public.category_overrides for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.category_overrides to authenticated;

-- What the app reads as "categories": built-ins with this user's overrides
-- applied, plus their own custom rows. security_invoker so RLS applies, and
-- the redundant predicate so a later replace that drops the flag fails
-- closed (CLAUDE.md).
create view public.user_categories
with (security_invoker = on) as
select
  c.id,
  c.slug,
  c.parent_id,
  c.kind,
  c.icon,
  c.sort_order,
  coalesce(o.name, c.name) as name,
  coalesce(o.color, c.color) as color,
  coalesce(o.hidden, false) as hidden,
  c.user_id is not null as is_custom,
  o.category_id is not null as overridden
from public.categories c
left join public.category_overrides o
  on o.category_id = c.id and o.user_id = (select auth.uid())
where c.user_id is null or c.user_id = (select auth.uid());

grant select on public.user_categories to authenticated;
```

- [ ] **Step 3: Push**

Run (repo root): `echo Y | npx --no-install supabase db push`
Expected: `20260924210000_phase7b_custom_categories.sql` applied.

- [ ] **Step 4: Verify grants and ACLs**

```sh
npx --no-install supabase db query --linked -o csv "select has_column_privilege('authenticated','public.categories','name','UPDATE') name_upd, has_column_privilege('authenticated','public.categories','parent_id','UPDATE') parent_upd, has_column_privilege('authenticated','public.categories','parent_id','INSERT') parent_ins, has_column_privilege('authenticated','public.categories','kind','INSERT') kind_ins, has_column_privilege('authenticated','public.categories','slug','INSERT') slug_ins, has_table_privilege('authenticated','public.categories','DELETE') cat_delete, has_table_privilege('anon','public.user_categories','SELECT') anon_view"
npx --no-install supabase db query --linked -o csv "select c.relname, c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('category_overrides','user_categories')"
```

Expected:
- `name_upd=t, parent_upd=f, parent_ins=t, kind_ins=f, slug_ins=f, cat_delete=f, anon_view=f`.
- `category_overrides`: `authenticated=arwd`.
- `user_categories`: `authenticated=r`.
- Neither lists anon.

- [ ] **Step 5: Verify behaviour as real users.** Each block runs in one statement and ends by raising, so nothing persists. Set `A=ccbd42ef-cba6-4f05-a100-a83a727255b2` (the test user) and `B=33c789b7-d651-43c2-a265-d2b7d86f5580` (the other user; read-only here).

```sh
npx --no-install supabase db query --linked -o csv "do \$\$ declare new_id uuid; k text; seen_by_b int; sort int; begin perform set_config('request.jwt.claims', json_build_object('sub','ccbd42ef-cba6-4f05-a100-a83a727255b2','role','authenticated')::text, true); set local role authenticated; insert into public.categories (name, parent_id, icon, color) select '  Plan test ', id, 'Tag', '#E07856' from public.categories where slug = 'food_and_dining' returning id, kind, sort_order into new_id, k, sort; perform set_config('request.jwt.claims', json_build_object('sub','33c789b7-d651-43c2-a265-d2b7d86f5580','role','authenticated')::text, true); select count(*) into seen_by_b from public.user_categories where id = new_id; raise exception 'rolled back: kind=% sort=% seen_by_b=%', k, sort, seen_by_b; end \$\$"
```

Expected: `rolled back: kind=expense sort=1000 seen_by_b=0`. The name's padding is the app's to trim; the database only checks the trimmed length.

The next four blocks must each fail as named:

```sh
# a client may not name kind
npx --no-install supabase db query --linked -o csv "do \$\$ begin perform set_config('request.jwt.claims', json_build_object('sub','ccbd42ef-cba6-4f05-a100-a83a727255b2','role','authenticated')::text, true); set local role authenticated; insert into public.categories (name, parent_id, icon, color, kind) select 'x', id, 'Tag', '#E07856', 'income' from public.categories where slug = 'food_and_dining'; end \$\$"
# expected: permission denied for table categories

# a blank name is refused
npx --no-install supabase db query --linked -o csv "do \$\$ begin perform set_config('request.jwt.claims', json_build_object('sub','ccbd42ef-cba6-4f05-a100-a83a727255b2','role','authenticated')::text, true); set local role authenticated; insert into public.categories (name, parent_id, icon, color) select '   ', id, 'Tag', '#E07856' from public.categories where slug = 'food_and_dining'; end \$\$"
# expected: violates check constraint "categories_name_length"

# a built-in cannot be edited directly (RLS update policy: 0 rows, so raise if any changed)
npx --no-install supabase db query --linked -o csv "do \$\$ declare n int; begin perform set_config('request.jwt.claims', json_build_object('sub','ccbd42ef-cba6-4f05-a100-a83a727255b2','role','authenticated')::text, true); set local role authenticated; update public.categories set name = 'Hacked' where slug = 'groceries'; get diagnostics n = row_count; raise exception 'rolled back: built-in rows changed=%', n; end \$\$"
# expected: rolled back: built-in rows changed=0

# an override on a custom row is refused, an override on a built-in shows in the view
npx --no-install supabase db query --linked -o csv "do \$\$ declare new_id uuid; nm text; hid boolean; ov boolean; begin perform set_config('request.jwt.claims', json_build_object('sub','ccbd42ef-cba6-4f05-a100-a83a727255b2','role','authenticated')::text, true); set local role authenticated; insert into public.category_overrides (category_id, name, hidden) select id, 'Supermarket', true from public.categories where slug = 'groceries'; select name, hidden, overridden into nm, hid, ov from public.user_categories where slug = 'groceries'; insert into public.categories (name, parent_id, icon, color) select 'Mine', id, 'Tag', '#E07856' from public.categories where slug = 'food_and_dining' returning id into new_id; raise notice 'view: % % %', nm, hid, ov; insert into public.category_overrides (category_id, name) values (new_id, 'nope'); end \$\$"
# expected: only built-in categories take overrides (the view notice, if shown: Supermarket t t)
```

- [ ] **Step 6: Re-run Step 1's manual checksum.** It must be identical.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260924210000_phase7b_custom_categories.sql
git commit -m "feat(db): custom categories and per-user overrides of the built-ins"
```

### Task 2: Server — `delete-category`, and per-user transfer ids in sync

**Files:**
- Create: `supabase/functions/_shared/categories.ts`
- Create: `supabase/functions/_shared/categories.test.ts`
- Create: `supabase/functions/delete-category/index.ts`
- Modify: `supabase/functions/_shared/recurring.test.ts` (one test)
- Modify: `supabase/functions/_shared/sync.ts` (`loadSyncContext`, and the `refreshRecurring` call)

**Interfaces:**
- Consumes: Task 1's grants. The function uses the service role, so it bypasses them, and its own `user_id` filters scope every write.
- Produces:
  - `readCategoryId(body: unknown): string | null`.
  - `planCategoryDelete(row: { id: string; parent_id: string | null; user_id: string | null } | null, callerId: string): { moveTo: string } | null`.
  - `POST /functions/v1/delete-category { category_id }` answers 200 `{ ok: true, moved: number }`, or 400 / 401 / 404 / 500 `{ error }`.

- [ ] **Step 1: Write the failing tests** (`supabase/functions/_shared/categories.test.ts`):

```ts
import { assertEquals } from 'jsr:@std/assert';

import { planCategoryDelete, readCategoryId } from './categories.ts';

const ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const GROUP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

Deno.test('readCategoryId accepts a UUID', () => {
  assertEquals(readCategoryId({ category_id: ID }), ID);
});

Deno.test('readCategoryId rejects a missing, non-string or malformed id', () => {
  // A non-UUID would reach PostgREST as 22P02, a 500, instead of a 400.
  for (const body of [null, 'x', {}, { category_id: 42 }, { category_id: 'abc' }, { category_id: `${ID}x` }]) {
    assertEquals(readCategoryId(body), null);
  }
});

Deno.test("planCategoryDelete moves the caller's custom category to its group", () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: ME }, ME), { moveTo: GROUP });
});

Deno.test('planCategoryDelete refuses a built-in', () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: null }, ME), null);
  assertEquals(planCategoryDelete({ id: GROUP, parent_id: null, user_id: null }, ME), null);
});

Deno.test("planCategoryDelete refuses another user's category", () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: THEM }, ME), null);
});

Deno.test('planCategoryDelete refuses a missing row', () => {
  assertEquals(planCategoryDelete(null, ME), null);
});
```

Append to `recurring.test.ts`:

```ts
Deno.test('ignoredCategoryIds includes a custom transfer category', () => {
  // Custom rows have no slug; sync now passes the owner's transfer children in.
  assertEquals(ignoredCategoryIds([{ id: 'u-venmo', kind: 'transfer', slug: null }]), ['u-venmo']);
});
```

- [ ] **Step 2: Run them to see the failure**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: FAIL with `Module not found "…/_shared/categories.ts"`. The `ignoredCategoryIds` test passes already, since it pins behaviour the new sync code relies on. Note it in the ledger.

- [ ] **Step 3: Implement `supabase/functions/_shared/categories.ts`**

```ts
/**
 * Pure checks for the category functions (Phase 7b), kept apart from the
 * handler so ownership and body shape are Deno-tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The body's category_id, or null when it is missing or not a UUID. Checked up
 * front: PostgREST would answer a malformed id with 22P02, a 500.
 */
export function readCategoryId(body: unknown): string | null {
  const id = (body as { category_id?: unknown } | null)?.category_id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

export type CategoryRow = { id: string; parent_id: string | null; user_id: string | null };

/**
 * Where a deleted category's transactions and streams go: its group. Null means
 * "not yours to delete" — a built-in, another user's row, or no row at all —
 * and the handler answers all three with the same 404, so ids never leak.
 */
export function planCategoryDelete(row: CategoryRow | null, callerId: string): { moveTo: string } | null {
  if (!row || row.user_id !== callerId || row.parent_id === null) return null;
  return { moveTo: row.parent_id };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: 73 + 6 + 1 = 80 passed, 0 failed.

- [ ] **Step 5: Write `supabase/functions/delete-category/index.ts`**

```ts
// Delete one of the caller's custom categories. Its transactions (manual flags
// kept) and recurring streams move to its group, its budget goes, and the row
// goes last, so a failure part-way leaves a state a retry finishes.
// JWT-verified by default: no config.toml entry.

import { planCategoryDelete, readCategoryId } from '../_shared/categories.ts';
import { corsHeaders, getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the field check
  }
  const categoryId = readCategoryId(body);
  if (!categoryId) return jsonResponse({ error: 'category_id is required' }, 400);

  try {
    const { data: row, error: rowError } = await admin
      .from('categories')
      .select('id, parent_id, user_id')
      .eq('id', categoryId)
      .maybeSingle();
    if (rowError) throw rowError;
    const plan = planCategoryDelete(row, user.id);
    if (!plan) return jsonResponse({ error: 'Unknown category' }, 404);

    const { count: moved, error: txError } = await admin
      .from('transactions')
      .update({ category_id: plan.moveTo }, { count: 'exact' })
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (txError) throw txError;

    // Derived, and refreshed by the next sync; moved now so the delete below
    // never trips their foreign key.
    const { error: streamError } = await admin
      .from('recurring_streams')
      .update({ category_id: plan.moveTo })
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (streamError) throw streamError;

    const { error: budgetError } = await admin
      .from('budgets')
      .delete()
      .eq('user_id', user.id)
      .eq('category_id', categoryId);
    if (budgetError) throw budgetError;

    const { error: deleteError } = await admin
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('user_id', user.id);
    if (deleteError) throw deleteError;

    return jsonResponse({ ok: true, moved: moved ?? 0 });
  } catch (err) {
    console.error(`delete-category failed for ${categoryId}`, err);
    return jsonResponse({ error: 'Could not delete the category' }, 500);
  }
});
```

- [ ] **Step 6: Per-user transfer ids in `sync.ts`.** `loadSyncContext` must stop loading every user's rows (the 7a handoff item).
  - Change its categories query to `admin.from('categories').select('id, kind, slug').is('user_id', null)`.
  - Update the `transferCategoryIds` doc comment to: "Built-in categories recurring detection ignores (transfers, except card payments); syncItem adds the owner's custom transfers."
  - In `syncItem`, replace `await refreshRecurring(admin, item, transferCategoryIds);` with:

```ts
      // The owner's custom transfer categories join the built-in ones. Loaded
      // per Item, so the shared context never holds every user's rows.
      const { data: ownTransfers, error: ownError } = await admin
        .from('categories')
        .select('id, kind, slug')
        .eq('user_id', item.user_id)
        .eq('kind', 'transfer');
      if (ownError) throw ownError;
      await refreshRecurring(admin, item, [...transferCategoryIds, ...ignoredCategoryIds(ownTransfers ?? [])]);
```

  It sits inside the existing `try`, so a failure costs only the radar and a log line, as before.

- [ ] **Step 7: Check and deploy**

Run: `npx -y deno test supabase/functions/_shared/ && npx -y deno check supabase/functions/delete-category/index.ts supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts`
Expected: 80 passed, and all three files check.

Then deploy each: `npx --no-install supabase functions deploy delete-category --use-api`, then `plaid-sync-transactions`, then `plaid-webhook`.
Expected: three "Deployed Functions." lines.

- [ ] **Step 8: Error paths with a real JWT.**
  - Extract the test user's `access_token` from the emulator into the scratchpad (see `tusky-tooling-notes`: `adb exec-out run-as com.tusky.app cat databases/RKStorage`, then a regex). Never print it.
  - Read `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/mobile/.env`.
  - POST to `$URL/functions/v1/delete-category` with `Authorization: Bearer $JWT`, `apikey: $ANON` and a JSON body. Expect:
    - `{"category_id":"nope"}` → 400;
    - the `groceries` built-in id (from SQL) → 404;
    - a random UUID → 404;
    - no Authorization header → 401.
  - Then SQL: the `groceries` row still exists.
  - Delete the token file.

- [ ] **Step 9: Sync smoke.** Pull to refresh on Transactions. Then check `node scripts/emu.mjs logs` is clean, and that `plaid_items.updated_at` for Chase moved and `sync_locked_at` is null.

- [ ] **Step 10: Commit** — `feat: delete-category function; sync loads only the owner's custom transfers`

### Task 3: App data layer — the view, edit hooks, pure helpers

**Files:**
- Create: `apps/mobile/src/lib/functions.ts` (`readFunctionError`, moved out of `plaid.ts`)
- Modify: `apps/mobile/src/lib/plaid.ts` (import it from `./functions`)
- Modify: `apps/mobile/src/lib/queries.ts` (`Category`, `useCategories`, the four edit hooks, `countCategoryTransactions`)
- Modify: `apps/mobile/src/lib/categories.ts`
- Modify: `apps/mobile/src/lib/categories.test.ts`, `apps/mobile/src/lib/reports.test.ts` (the `cat()` helpers)

**Interfaces:**
- Consumes: Task 1's view and grants, and Task 2's function.
- Produces:
  - `Category`: `slug: string | null` and new `hidden: boolean`, `is_custom: boolean`, `overridden: boolean`.
  - `type CategoryPatch = { name?: string | null; color?: string | null; hidden?: boolean }`.
  - `useCategoryOverride()`: a mutation of `{ categoryId: string; patch: CategoryPatch | null }`, where `null` means reset. Optimistic on `hidden`.
  - `useCreateCategory()`: a mutation of `{ parentId: string; name: string; icon: string; color: string }`.
  - `useUpdateCategory()`: a mutation of `{ id: string; name: string; icon: string; color: string }`.
  - `useDeleteCategory()`: a mutation of `categoryId: string` returning `{ moved: number }`. It throws an `Error` carrying the function's message.
  - `countCategoryTransactions(categoryId: string): Promise<number>`.
  - From `lib/categories.ts`:
    - `withoutHidden(tree: CategoryNode[], keepId: string | null): CategoryNode[]`;
    - `pickerSections(tree: CategoryNode[], opts: { selectedId: string | null })`, which returns `sectionsByKind`'s shape;
    - `validateCategoryName(raw: string): string | null`;
    - `changedFields(category: Category, edits: { name: string; color: string }): { name?: string; color?: string }`;
    - `deleteCategoryMessage(count: number, groupName: string, hasBudget: boolean): string`;
    - `SWATCHES: string[]` and `CUSTOM_ICONS: string[]`.

- [ ] **Step 1: The `Category` type and test helpers.** In `queries.ts`, replace `Category` with:

```ts
export type Category = {
  id: string;
  /** Built-ins only; a custom category has none. */
  slug: string | null;
  /** The user's name for it: their rename of a built-in, or their own category's. */
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  icon: string;
  /** The user's colour for it, as with name. */
  color: string;
  sort_order: number;
  /** null for a group; a child's group otherwise. */
  parent_id: string | null;
  /** Hidden by this user: out of the picker and Budgets' suggestions; its transactions and budget stay. */
  hidden: boolean;
  /** The user's own category, always a child of a built-in group. */
  is_custom: boolean;
  /** A built-in this user renamed, recoloured or hid. Reset deletes the override. */
  overridden: boolean;
};
```

  `useCategories` reads the view:

```ts
      const { data, error } = await supabase
        .from('user_categories')
        .select('id, slug, name, kind, icon, color, sort_order, parent_id, hidden, is_custom, overridden')
        .order('sort_order', { ascending: true });
```

  In both test files, change the `cat()` helper's returned object to end `…, icon: 'Tag', color: '#000000', hidden: false, is_custom: false, overridden: false,`.

- [ ] **Step 2: Write the failing tests** (append to `categories.test.ts`, and add the new names to its import from `./categories.ts`):

```ts
test('withoutHidden drops a hidden category, and a hidden group with its children', () => {
  const tree = buildTree([food, { ...coffee, hidden: true }, groceries, { ...transfer, hidden: true }, card, income]);
  const out = withoutHidden(tree, null);
  assert.deepEqual(out.map((g) => g.id), ['income', 'food']);
  assert.deepEqual(out[1].children.map((c) => c.id), ['groceries']);
});

test('withoutHidden keeps the selection and its group, even when both are hidden', () => {
  const tree = buildTree([{ ...food, hidden: true }, coffee, groceries]);
  const shape = (keepId: string | null) => withoutHidden(tree, keepId).map((g) => [g.id, g.children.map((c) => c.id)]);
  assert.deepEqual(shape('coffee'), [['food', ['coffee']]]);
  assert.deepEqual(shape('food'), [['food', []]]);
  assert.deepEqual(shape(null), []);
});

test('pickerSections drops hidden categories but keeps the selected one', () => {
  const tree = buildTree([food, { ...coffee, hidden: true }, groceries]);
  assert.deepEqual(pickerSections(tree, { selectedId: null })[0].groups[0].children.map((c) => c.id), ['groceries']);
  assert.deepEqual(
    pickerSections(tree, { selectedId: 'coffee' })[0].groups[0].children.map((c) => c.id),
    ['groceries', 'coffee'],
  );
});

test('validateCategoryName trims and allows 1–40 characters', () => {
  assert.equal(validateCategoryName('  Date night  '), 'Date night');
  assert.equal(validateCategoryName('   '), null);
  assert.equal(validateCategoryName(''), null);
  assert.equal(validateCategoryName('x'.repeat(40)), 'x'.repeat(40));
  assert.equal(validateCategoryName('x'.repeat(41)), null);
});

test('changedFields sends only what changed', () => {
  assert.deepEqual(changedFields(food, { name: 'food', color: '#000000' }), {});
  assert.deepEqual(changedFields(food, { name: 'Eating out', color: '#000000' }), { name: 'Eating out' });
  assert.deepEqual(changedFields(food, { name: 'food', color: '#E07856' }), { color: '#E07856' });
});

test('deleteCategoryMessage says where the transactions go, and about the budget', () => {
  assert.equal(deleteCategoryMessage(1, 'Food & Dining', false), 'Moves its 1 transaction to Food & Dining.');
  assert.equal(
    deleteCategoryMessage(3, 'Food & Dining', true),
    'Moves its 3 transactions to Food & Dining, and removes its budget.',
  );
  assert.equal(deleteCategoryMessage(0, 'Food & Dining', false), 'It has no transactions.');
});
```

- [ ] **Step 3: Run them to see the failure**

Run: `cd apps/mobile && npm test`
Expected: FAIL. `./categories.ts` does not provide an export named `withoutHidden`.

- [ ] **Step 4: Implement in `lib/categories.ts`** (append):

```ts
/**
 * The tree minus hidden categories, for the picker and Budgets' suggestions. A
 * hidden group takes its children with it. `keepId` survives regardless, with
 * its group, because the picker's current selection must stay visible and
 * checked.
 */
export function withoutHidden(tree: CategoryNode[], keepId: string | null): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const group of tree) {
    const children = group.children.filter((c) => c.id === keepId || (!c.hidden && !group.hidden));
    if (!group.hidden || group.id === keepId || children.length > 0) out.push({ ...group, children });
  }
  return out;
}

/** The picker's sections: hidden categories dropped, except the current selection. */
export function pickerSections(tree: CategoryNode[], { selectedId }: { selectedId: string | null }) {
  return sectionsByKind(withoutHidden(tree, selectedId));
}

/** A category name as stored: trimmed, 1–40 characters, as the database checks. Null when invalid. */
export function validateCategoryName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 40 ? name : null;
}

/**
 * A built-in's edit as an override patch: only the fields that changed, so a
 * colour change does not also pin today's name.
 */
export function changedFields(
  category: Category,
  edits: { name: string; color: string },
): { name?: string; color?: string } {
  const patch: { name?: string; color?: string } = {};
  if (edits.name !== category.name) patch.name = edits.name;
  if (edits.color !== category.color) patch.color = edits.color;
  return patch;
}

/** The delete confirmation's body. */
export function deleteCategoryMessage(count: number, groupName: string, hasBudget: boolean): string {
  const moves =
    count === 0 ? 'It has no transactions' : `Moves its ${count} transaction${count === 1 ? '' : 's'} to ${groupName}`;
  return `${moves}${hasBudget ? ', and removes its budget' : ''}.`;
}

/** Colour choices: the seeded group colours (category colours are data, not theme). */
export const SWATCHES = [
  '#55C084', '#94A198', '#E07856', '#D9A441', '#4E9BD1', '#A97ACD', '#D96BA0', '#46B3A8',
  '#E05A5A', '#C98BB8', '#8C9F5B', '#7C8BA1', '#B5784B', '#9A8C7A', '#6F8FA6',
];

/** Icon choices for a custom category; every name exists in the installed lucide-react-native. */
export const CUSTOM_ICONS = [
  'Tag', 'ShoppingBag', 'Coffee', 'Utensils', 'Car', 'House', 'Heart', 'Gift',
  'Plane', 'Music', 'Book', 'Dumbbell', 'PawPrint', 'Baby', 'Briefcase', 'GraduationCap',
  'Wrench', 'Smartphone', 'Shirt', 'Gamepad2', 'Camera', 'Leaf', 'Star', 'Wallet',
];
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/mobile && npm test`
Expected: 19 pass (13 + 6).

- [ ] **Step 6: `lib/functions.ts` and the hooks.**
  - Move `readFunctionError` verbatim from `plaid.ts` into a new `src/lib/functions.ts` as an `export`, keeping its doc comment.
  - In `plaid.ts`, import it with `import { readFunctionError } from '@/lib/functions';`.
  - Then append this to `queries.ts`, and add `import { readFunctionError } from '@/lib/functions';` at its top:

```ts
/** What a category edit changes on screen. Names resolve on the client, so these three are enough. */
const CATEGORY_EDIT_KEYS = [['categories'], ['reports'], ['budgets']];

export type CategoryPatch = { name?: string | null; color?: string | null; hidden?: boolean };

/**
 * Rename, recolour or hide a built-in for this user; a null patch resets it
 * (deletes the override). The upsert names only the patched columns, so the
 * others keep their stored values. Optimistic on `hidden`, so the switch
 * never lags.
 */
export function useCategoryOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ categoryId, patch }: { categoryId: string; patch: CategoryPatch | null }) => {
      const { error } =
        patch === null
          ? await supabase.from('category_overrides').delete().eq('category_id', categoryId)
          : await supabase
              .from('category_overrides')
              .upsert({ category_id: categoryId, ...patch }, { onConflict: 'user_id,category_id' });
      if (error) throw error;
    },
    onMutate: async ({ categoryId, patch }) => {
      const hidden = patch?.hidden;
      if (hidden === undefined) return {};
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      const previous = queryClient.getQueryData<Category[]>(['categories']);
      queryClient.setQueryData<Category[]>(['categories'], (old) =>
        old?.map((c) => (c.id === categoryId ? { ...c, hidden } : c)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['categories'], context.previous);
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Add a custom category under a group. The payload names exactly the granted
 * columns; user_id, kind and sort_order come from defaults and the tree trigger.
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ parentId, name, icon, color }: { parentId: string; name: string; icon: string; color: string }) => {
      const { error } = await supabase.from('categories').insert({ parent_id: parentId, name, icon, color });
      if (error) throw error;
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/** Edit one of the user's own categories. RLS refuses a built-in. */
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, icon, color }: { id: string; name: string; icon: string; color: string }) => {
      const { error } = await supabase.from('categories').update({ name, icon, color }).eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Delete one of the user's own categories through delete-category, which
 * moves its transactions and streams to the group first. Everything that
 * shows a category id can change.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string): Promise<{ moved: number }> => {
      const { data, error } = await supabase.functions.invoke('delete-category', {
        body: { category_id: categoryId },
      });
      if (error) {
        const { message } = await readFunctionError(error);
        throw new Error(message ?? 'Could not delete the category. Try again in a moment.');
      }
      return { moved: (data as { moved?: number } | null)?.moved ?? 0 };
    },
    onSettled: () => {
      for (const queryKey of [...CATEGORY_EDIT_KEYS, ...HIDDEN_DEPENDENT_KEYS]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/** How many of the user's transactions sit in one category, for the delete confirmation. */
export async function countCategoryTransactions(categoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `cd apps/mobile && npm test && npm run typecheck && npx expo lint`
Expected: 19 pass, and typecheck and lint are clean. If typecheck flags a `slug` use that assumed a string, fix the use site. Today there are none outside tests.

- [ ] **Step 8: Smoke.** Reload the app (dev menu: `node scripts/emu.mjs key 82`, then `tap Reload`). The feed's category labels are unchanged, which proves `useCategories` reads the view. `node scripts/emu.mjs logs` is clean.

- [ ] **Step 9: Commit** — `feat: categories read through user_categories, with edit hooks and hiding helpers`

### Task 4: Picker and Budgets respect hidden categories

**Files:**
- Modify: `apps/mobile/src/components/category-picker.tsx`
- Modify: `apps/mobile/src/app/(tabs)/budgets.tsx`

**Interfaces:**
- Consumes: `pickerSections` and `withoutHidden` from Task 3.

- [ ] **Step 1: Picker.** Replace the `sectionsByKind` import with `pickerSections`, and the `sections` memo with:

```tsx
  // Hidden categories leave the picker, but the current one stays so its check shows.
  const sections = useMemo(
    () => pickerSections(buildTree(categories), { selectedId }),
    [categories, selectedId],
  );
```

- [ ] **Step 2: Budgets.** Add `withoutHidden` to the `@/lib/categories` import. After `groupById`, add:

```tsx
  // Suggestions skip what the user hid. Existing budgets still show, and a
  // budgeted group's breakdown still lists every category with spend.
  const discoverable = useMemo(() => withoutHidden(groups, null), [groups]);
```

  In the "Not budgeted" section, change `{groups` to `{discoverable`. `groupById` stays built from the unfiltered `groups`, so a hidden, budgeted group keeps its breakdown.

- [ ] **Step 3:** Run `cd apps/mobile && npm test && npm run typecheck && npx expo lint`. Expect them clean, with 19 tests.

- [ ] **Step 4: Commit** — `feat: hidden categories leave the picker and budget suggestions`

  Behaviour is verified on the emulator in Task 6, once the screen exists to hide things.

### Task 5: The `/categories` screen and its sheet

**Files:**
- Create: `apps/mobile/src/components/category-sheet.tsx`
- Create: `apps/mobile/src/app/categories.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (register the route)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (the entry card)

**Interfaces:**
- Consumes: the Task 3 hooks and helpers, plus `buildTree` and `sectionsByKind`.
- Produces: `CategorySheet` with props `{ target: SheetTarget | null; onClose: () => void }`, and `type SheetTarget = { mode: 'edit'; category: Category; group: Category | undefined } | { mode: 'add'; group: Category }`.

- [ ] **Step 1: `components/category-sheet.tsx`**

```tsx
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CUSTOM_ICONS, SWATCHES, changedFields, deleteCategoryMessage, validateCategoryName } from '@/lib/categories';
import {
  type Category,
  countCategoryTransactions,
  useBudgets,
  useCategoryOverride,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/lib/queries';

/** Edit a category (group is its group, undefined for a group), or add one under a group. */
export type SheetTarget =
  | { mode: 'edit'; category: Category; group: Category | undefined }
  | { mode: 'add'; group: Category };

type Props = {
  /** Null closes the sheet. */
  target: SheetTarget | null;
  onClose: () => void;
};

/**
 * One sheet for every category edit. A built-in takes a name and a colour
 * (stored as this user's override); the user's own category also takes an icon
 * and can be deleted.
 */
export function CategorySheet({ target, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const editing = target?.mode === 'edit' ? target.category : null;
  const group = target?.group;
  // Seeded once per mount. The screen keys this sheet by target, as Budgets
  // keys BudgetSheet, so reopening never carries the last edit over.
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? 'Tag');
  const [color, setColor] = useState(editing?.color ?? group?.color ?? SWATCHES[0]);

  const { data: budgets = [] } = useBudgets();
  const setOverride = useCategoryOverride();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const valid = validateCategoryName(name);
  const custom = target?.mode === 'add' || editing?.is_custom === true;
  const busy =
    setOverride.isPending || createCategory.isPending || updateCategory.isPending || deleteCategory.isPending;
  const failed = () => Alert.alert('Could not save the category', 'Check your connection and try again.');

  const save = async () => {
    if (!target || !valid) return;
    try {
      if (target.mode === 'add') {
        await createCategory.mutateAsync({ parentId: target.group.id, name: valid, icon, color });
      } else if (target.category.is_custom) {
        await updateCategory.mutateAsync({ id: target.category.id, name: valid, icon, color });
      } else {
        const patch = changedFields(target.category, { name: valid, color });
        if (Object.keys(patch).length > 0) {
          await setOverride.mutateAsync({ categoryId: target.category.id, patch });
        }
      }
      onClose();
    } catch {
      failed();
    }
  };

  const reset = async () => {
    if (!editing) return;
    try {
      await setOverride.mutateAsync({ categoryId: editing.id, patch: null });
      onClose();
    } catch {
      failed();
    }
  };

  const confirmDelete = async () => {
    if (!editing) return;
    let count: number;
    try {
      count = await countCategoryTransactions(editing.id);
    } catch {
      failed();
      return;
    }
    const hasBudget = budgets.some((b) => b.category_id === editing.id);
    Alert.alert(`Delete ${editing.name}?`, deleteCategoryMessage(count, group?.name ?? 'its group', hasBudget), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteCategory.mutateAsync(editing.id).then(onClose, (err: Error) =>
            Alert.alert('Could not delete the category', err.message),
          ),
      },
    ]);
  };

  return (
    <Modal visible={target !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: Radius.xl,
          borderTopRightRadius: Radius.xl,
          paddingTop: Spacing.lg,
          paddingHorizontal: Spacing.md,
          paddingBottom: insets.bottom + Spacing.md,
          gap: Spacing.md,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: Radius.full,
              backgroundColor: colors.elevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <CategoryIcon name={icon} size={17} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="title">{target?.mode === 'add' ? 'New category' : (editing?.name ?? '')}</AppText>
            {group ? (
              <AppText variant="caption" tone="dim">
                In {group.name}
              </AppText>
            ) : null}
          </View>
        </View>

        <TextField label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="e.g. Date night" />

        {custom ? (
          <View style={{ gap: Spacing.xs + 2 }}>
            <AppText variant="label" tone="dim">
              Icon
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {CUSTOM_ICONS.map((iconName) => (
                <Pressable
                  key={iconName}
                  accessibilityLabel={`Icon ${iconName}`}
                  onPress={() => setIcon(iconName)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: Radius.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: icon === iconName ? colors.elevated : 'transparent',
                    borderWidth: icon === iconName ? 1 : 0,
                    borderColor: colors.brand,
                  }}>
                  <CategoryIcon name={iconName} size={17} color={icon === iconName ? color : colors.textDim} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: Spacing.xs + 2 }}>
          <AppText variant="label" tone="dim">
            Colour
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
            {SWATCHES.map((swatch) => (
              <Pressable
                key={swatch}
                accessibilityLabel={`Colour ${swatch}`}
                onPress={() => setColor(swatch)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: Radius.full,
                  backgroundColor: swatch,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {color === swatch ? <Check size={16} color={colors.bg} /> : null}
              </Pressable>
            ))}
          </View>
        </View>

        <Button
          title={target?.mode === 'add' ? 'Add category' : 'Save'}
          disabled={!valid}
          loading={busy}
          onPress={() => void save()}
        />
        {editing && !editing.is_custom && editing.overridden ? (
          <Button title="Reset to default" variant="ghost" onPress={() => void reset()} />
        ) : null}
        {editing?.is_custom ? (
          <Button title="Delete category" variant="ghost" onPress={() => void confirmDelete()} />
        ) : null}
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: `app/categories.tsx`**

```tsx
import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategorySheet, type SheetTarget } from '@/components/category-sheet';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildTree, sectionsByKind } from '@/lib/categories';
import { type Category, useCategories, useCategoryOverride } from '@/lib/queries';

const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};
const sectionLabel = { textTransform: 'uppercase', letterSpacing: 1.1 } as const;

const sheetKey = (target: SheetTarget | null) =>
  target === null ? 'none' : target.mode === 'add' ? `add-${target.group.id}` : target.category.id;

/** Every category, hidden ones included, grouped: rename, recolour, hide, or add your own. */
export default function CategoriesScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: categories = [] } = useCategories();
  const sections = useMemo(() => sectionsByKind(buildTree(categories)), [categories]);
  const setOverride = useCategoryOverride();
  const [target, setTarget] = useState<SheetTarget | null>(null);

  const setHidden = (category: Category, hidden: boolean) =>
    setOverride.mutate(
      { categoryId: category.id, patch: { hidden } },
      { onError: () => Alert.alert('Could not update the category', 'Check your connection and try again.') },
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }}>
        <AppText variant="caption" tone="dim">
          Rename, recolour or hide the built-in categories, or add your own under any group. A hidden category
          leaves the picker and budget suggestions; its transactions and budget stay.
        </AppText>

        {sections.map(({ kind, groups }) => (
          <View key={kind} style={{ gap: Spacing.sm }}>
            <AppText variant="caption" tone="dim" style={sectionLabel}>
              {KIND_LABEL[kind]}
            </AppText>
            {groups.map((group) => (
              <Card key={group.id} style={{ paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md }}>
                <CategoryLine
                  category={group}
                  onPress={() => setTarget({ mode: 'edit', category: group, group: undefined })}
                  onToggle={(show) => setHidden(group, !show)}
                />
                {group.children.map((child) => (
                  <CategoryLine
                    key={child.id}
                    category={child}
                    indent
                    dimmed={group.hidden}
                    onPress={() => setTarget({ mode: 'edit', category: child, group })}
                    // A custom category is deleted, not hidden: overrides are for built-ins.
                    onToggle={child.is_custom ? undefined : (show) => setHidden(child, !show)}
                  />
                ))}
                <Pressable
                  onPress={() => setTarget({ mode: 'add', group })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.sm,
                    paddingVertical: Spacing.sm,
                    paddingLeft: Spacing.lg,
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  <Plus size={16} color={colors.brand} strokeWidth={2} />
                  <AppText variant="label" tone="brand">
                    Add category
                  </AppText>
                </Pressable>
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>

      <CategorySheet key={sheetKey(target)} target={target} onClose={() => setTarget(null)} />
    </View>
  );
}

function CategoryLine({
  category,
  indent = false,
  dimmed = false,
  onPress,
  onToggle,
}: {
  category: Category;
  indent?: boolean;
  /** Its group is hidden, which hides it too. */
  dimmed?: boolean;
  onPress: () => void;
  onToggle?: (show: boolean) => void;
}) {
  const colors = useTheme();
  const faded = category.hidden || dimmed;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm,
        paddingLeft: indent ? Spacing.lg : 0,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View
        style={{
          width: indent ? 28 : 34,
          height: indent ? 28 : 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: faded ? 0.5 : 1,
        }}>
        <CategoryIcon name={category.icon} size={indent ? 14 : 17} color={category.color} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant={indent ? 'body' : 'label'} tone={faded ? 'dim' : 'default'}>
          {category.name}
        </AppText>
        {category.is_custom ? (
          <AppText variant="caption" tone="dim">
            Custom
          </AppText>
        ) : category.hidden ? (
          <AppText variant="caption" tone="dim">
            Hidden
          </AppText>
        ) : null}
      </View>
      {onToggle ? (
        <Switch
          value={!category.hidden}
          accessibilityLabel={`Show ${category.name}`}
          trackColor={{ false: colors.elevated, true: colors.brand }}
          onValueChange={onToggle}
        />
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 3: Register and link.**
  - In `_layout.tsx`, after the `bank/[id]` screen, add:
    - the comment `{/* Pushed from Settings. */}`;
    - `<Stack.Screen name="categories" options={{ headerShown: true, title: 'Categories' }} />`.
  - In `settings.tsx`:
    - add `Tags` to the lucide import;
    - between the Connections and Account cards, add:

```tsx
      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Categories
        </AppText>
        <Pressable
          onPress={() => router.push('/categories')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <Tags size={20} color={colors.brand} strokeWidth={1.75} />
          <AppText variant="label" style={{ flex: 1 }}>
            Rename, hide or add categories
          </AppText>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
      </Card>
```

- [ ] **Step 4:** Run `cd apps/mobile && npm test && npm run typecheck && npx expo lint`. Expect them clean. If typecheck rejects `'/categories'` as an unknown route, Metro regenerates the typed routes once it sees the new file: wait for the hot reload and re-run.

- [ ] **Step 5: Emulator smoke.** Settings → "Rename, hide or add categories". Expect the header "Categories" and the Expenses groups, each followed by its children and "Add category". Logs are clean.

- [ ] **Step 6: Commit** — `feat: categories screen — rename, recolour, hide, add and delete`

### Task 6: Verification pass

**Files:** none; the evidence goes in the ledger. The test user throughout is `user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'`.

- [ ] **Step 1: Automated.** `npx -y deno test supabase/functions/_shared/` should report 80 passed. Then run `cd apps/mobile && npm test && npm run typecheck && npx expo lint`: 19 pass, and typecheck and lint are clean.

- [ ] **Step 2: Hide.**
  - Toggle off **Coffee Shops**. SQL: `category_overrides` has `hidden = true` for it.
  - The picker, on any transaction, no longer lists Coffee Shops.
  - Budgets' "Show all categories" no longer lists it.
  - Toggle off the **Entertainment** group. The picker drops the whole group.
  - Toggle both back on.

- [ ] **Step 3: Rename, recolour and reset.**
  - Tap **Groceries**, rename it "Supermarket", pick another swatch, and Save.
  - SQL: the override row has `name = 'Supermarket'` and the new colour.
  - The feed, the picker and Reports' Food & Dining drill-in all say "Supermarket".
  - Reopen it and tap **Reset to default**. SQL: no override row; "Groceries" is back.

- [ ] **Step 4: Custom category round trip.**
  - Under **Food & Dining**, add "Date night" with the Heart icon.
  - SQL: `select name, kind, user_id is not null, sort_order from categories where name = 'Date night'` returns `Date night, expense, t, 1000`.
  - In the feed, set Chipotle to **Date night**. The label changes; SQL shows it is manual and on the custom id.
  - Set a $40 budget on it from Budgets (with "Show all").
  - Back on the Categories screen, tap Date night → **Delete category**. Expect "Moves its 1 transaction to Food & Dining, and removes its budget." Confirm.
  - SQL:
    - Chipotle is now on `food_and_dining` with `category_is_manual = true`;
    - there is no `Date night` row and no budget for its id;
    - the budgets are the original 4.
  - Pull to refresh, then SQL again: Chipotle is still on `food_and_dining`.
  - Revert Chipotle by SQL: set it to `fast_food` with `category_is_manual = false`.

- [ ] **Step 5: Isolation** (already proven by Task 1 Step 5's `seen_by_b=0`). Also run `select count(*) from category_overrides; select count(*) from categories where user_id is not null`. Expect 0 and 0 after cleanup.

- [ ] **Step 6: Regression.**
  - Home, the feed and its labels, Reports and its drill-in, Budgets and its prompts, and the bank screen.
  - The manual checksum equals Task 1's baseline.
  - `node scripts/emu.mjs logs` is clean.

- [ ] **Step 7:** Ledger every check with its numbers.

### Task 7: Docs and PR

**Files:**
- Modify: `README.md`. Mark 7b ✅, and make 7c "Next".
- Modify: `CLAUDE.md`:
  - The status pointer: 7b built, 7c next, latest handoff → the 7b handoff.
  - A convention entry: custom categories and overrides. The rules to include are that `user_categories` is what the app reads, that overrides are for built-ins only, the column grants and why `parent_id` is insert-only, that deletes go through `delete-category`, and that sync loads the owner's custom transfers per Item.
- Modify: the spec's Status line ("7a and 7b built").
- Create: `docs/superpowers/plans/2026-09-24-phase-7b-handoff.md`. It covers what shipped, the verification numbers, and what 7c needs. In particular, `delete-category` must gain the merchant-rules step, and 7c's `set-merchant-rule` must accept custom category ids that the caller owns.

- [ ] **Step 1:** Write the docs. Commit: `docs: Phase 7b handoff`.
- [ ] **Step 2:** `git push -u origin pedro-7b`, then:

```powershell
gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro-7b --title "Phase 7b: custom categories and built-in overrides" --body-file <scratchpad>/pr-7b-body.md
```

  The body says it is stacked on #6: merge #6 first, after which the diff shows 7b alone. It ends with the Claude Code attribution line. Never merge it.
