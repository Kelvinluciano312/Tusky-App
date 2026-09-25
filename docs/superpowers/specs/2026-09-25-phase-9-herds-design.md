# Phase 9: names, herds (shared households), who paid, and the production project

Status: approved 2026-09-25 (Pedro). Built as milestones 9a → 9b → 9c → 9d, plus Track P (ops) in parallel.

## Context

Phase 8 (transaction review) is built and waiting in PR #10. Pedro wants three things next:
- real names instead of the email prefix;
- shared households ("herds");
- "who paid" on transactions.

He also wants real data in a second Supabase project, created under the Ouroboros Studios account (`awiwcgrisyzimzxgddxu`).

Decisions made with Pedro on 2026-09-25:

| Topic | Decision |
| --- | --- |
| Names | Display name, not unique. Asked at signup, editable in Settings. |
| Sharing | Accounts are shared with the herd by default. The person who connected an account can mark it private. |
| Joining | The joiner's data merges into the herd (they must be alone in their own herd). The herd's settings win on conflicts. |
| Leaving | The banks you connected leave with you, into a new herd of your own. Shared budgets, categories and rules stay. |
| Roles | The owner invites (by code) and removes members; anyone can leave. |
| Bank control | Only the member who connected a bank can reconnect or disconnect it. |
| Real data | A second project. Dev builds get a Settings switch between Sandbox and Real data; Play builds are real data only. |

**Order:** 9a first, with Track P running in parallel (it waits on Pedro's steps), then 9b, 9c and 9d. That makes one PR per milestone, each with a spec section, a lean plan and a handoff. Start once #10 is merged, or stack on `pedro-8`.

**First execution step:** commit this design as `docs/superpowers/specs/2026-09-25-phase-9-herds-design.md` and `docs/ops/production.md`.

---

## 9a: Display names (small)

**DB**
- `profiles(user_id pk → auth.users on delete cascade, display_name text check 1–40 trimmed, timestamps)`.
- An `after insert on auth.users` trigger, `public.handle_new_user()`: security definer, `search_path=''`. It reads `raw_user_meta_data->>'display_name'`, trims it and caps it at 40 characters. If that is empty it falls back to the email prefix, so a bad value can never fail a signup.
- Backfill existing users from the email prefix.

**Permissions**
- RLS: each user selects and updates only their own row. This widens to herd mates in 9c.
- `grant select, update (display_name)`.
- First function in `public`: revoke `EXECUTE` from PUBLIC, via default privileges plus explicit revokes, as CLAUDE.md asks.

**App**
- `lib/profile.ts`: `validatePersonName`, covered by `npm test`.
- Sign-up gets a required "Your name" field, sent as `signUp({ options: { data: { display_name } } })`.
- Settings gets a top "You" card: the name opens a `NameSheet` (same pattern as `rename-sheet.tsx`), plus the email and Sign out.
- Home greets you by the first word of your name (`(tabs)/index.tsx:35` today uses the email).
- `useProfile()`.
- **Fix:** sign-out calls `queryClient.clear()`. Today the next user briefly sees cached data.

---

## Track P: production project (Ouroboros account)

**Never run `supabase init` (config.toml already exists) or `supabase link` to prod.** The CLI stays linked to dev. Prod commands name their target every time, and each one waits for Pedro's go-ahead.

1. **Access (Pedro).** Invite ph.leao2099's Supabase account into the Ouroboros org as Administrator, so one CLI login reaches both projects. Fallback: a prod-only `SUPABASE_ACCESS_TOKEN` kept in gitignored `supabase/.env.prod`.
2. **Code fix.** `getAdminClient()` (`_shared/lib.ts:17-22`) reads `SUPABASE_SECRET_KEYS.default` and falls back to `SUPABASE_SERVICE_ROLE_KEY`, because new projects may not have the legacy key. `verify_jwt` accepts both user-JWT kinds, so config.toml is unchanged.
3. **Database.** `db push --db-url <prod pooler URL> --dry-run`, then apply. The password lives in `supabase/.env.prod` (gitignored).
4. **Functions.** `functions deploy <name> --project-ref awiwcgrisyzimzxgddxu --use-api` for every function **except `plaid-sandbox`**.
5. **Secrets.** Pedro or Kelvyn type `PLAID_SECRET` (production) into the prod dashboard themselves, so it never passes through chat. I set `PLAID_CLIENT_ID` and `PLAID_ENV=production` with `secrets set NAME=value --project-ref …`.
6. **Auth, in the prod dashboard.** Email confirmation on. Built-in email is enough for two users.
7. **App.** The publishable key Pedro shared goes into `apps/mobile/.env` as `EXPO_PUBLIC_PROD_SUPABASE_URL/KEY`.
   - `lib/supabase.ts` picks the backend from a persisted choice. Only dev builds show the switch.
   - Switching reloads the app. Sessions don't collide, because supabase-js keys storage by project ref.
   - A "Real data" banner shows while on prod. The Settings footer shows the environment instead of the hardcoded "Plaid Sandbox".
8. **Kelvyn's Plaid dashboard** allows `com.tusky.app`. Pedro and Kelvyn sign up in prod and link banks: non-OAuth banks now, big OAuth banks after Plaid approves. Stay at or under 10 Items.
9. **Rules.** A CLAUDE.md section records that migrations go to dev first, then prod after a go-ahead. Optional: a weekly `db dump` to a folder outside the repo, since Free has no backups.
10. The Phase 6 key switch for dev becomes optional: dev can stay on its current Sandbox keys.

---

## 9b: Herd foundation (refactor, no visible change)

Every user gets a personal herd, and access moves from `user_id` to `herd_id`. Everything still looks the same, because every herd has one member.

**Tables and helpers**
- `herds(id, name 1–40)`.
- `herd_members(herd_id, user_id, role owner|member, joined_at)`: pk `(herd_id, user_id)`, plus `unique(user_id)` so each user is in exactly one herd.
- `handle_new_user` also creates the personal herd ("Pedro's herd"). A backfill does the same for existing users.
- RLS helpers in a non-exposed `private` schema: security definer, `search_path=''`, stable, `EXECUTE` for authenticated only.
  - `private.my_herd_id()`.
  - `private.my_account_ids()`: accounts in my herd that are not private or that I connected.

**Column changes**
- **Plaid data** (`plaid_items`, accounts, transactions, balance_snapshots, recurring_streams):
  - add `herd_id not null` and `accounts.is_private bool default false`;
  - keep `user_id`, which now means "connected by" and is never an access check.
- **Config** (budgets, category_overrides, merchant_rules, custom categories):
  - swap `user_id` for `herd_id`;
  - built-ins are marked by `herd_id is null`, which replaces the 8 places that rely on `user_id is null`;
  - new uniques on `(herd_id, …)`;
  - client inserts get `herd_id default private.my_herd_id()`.

**Consistency by construction**
- `plaid_items unique(id, herd_id)`, and accounts get `fk(item_id, herd_id) → plaid_items on update cascade`.
- `accounts unique(id, herd_id)`, and transactions, snapshots and streams get `fk(account_id, herd_id) → accounts on update cascade`.
- Result: moving a bank between herds is a single update of `plaid_items.herd_id`, and nothing can be left behind in the old herd.
- A category-scope trigger on transactions, budgets, streams and rules (`before insert or update of category_id, herd_id`): the category must be built-in or belong to the row's herd. This closes the hole where an FK check bypasses RLS.
- A `BEFORE INSERT` trigger fills `herd_id` from the item or account. The currently deployed functions keep working in the window between `db push` and redeploy, and no call site can forget it.

**Policies and views**
- Accounts: `id = any((select private.my_account_ids()))`.
- Transactions, snapshots, streams: `herd_id = (select private.my_herd_id()) and account_id = any(...)`.
- Items: my herd, and either I connected it or it has an account I can see.
- Config tables: my herd.
- Rebuild `monthly_category_totals`, `daily_net_worth` and `user_categories` with herd filters. Keep `security_invoker`.
- Indexes: `(herd_id, date desc, id desc)` for the feed, plus the merchant_key, unreviewed, snapshot and stream indexes rebuilt on `herd_id`.

**Migration order** (one migration, one transaction):
1. Create herds and members, and backfill them.
2. Add the columns nullable, backfill them, then set not null.
3. Add the FKs and uniques.
4. Drop the old policies, uniques and views, and create the new ones.
5. Drop the old config `user_id` columns.
6. Revoke default `EXECUTE` on functions.

**Server**
- `lib.getCallerHerd()`.
- **Scope changes:**
  - create-link-token update mode, disconnect and sandbox: connector only. A mate gets 404, and the app says "Ask X to reconnect".
  - `plaid-sync-transactions` syncs every live Item in the herd.
  - The exchange duplicate check covers the whole herd, including private accounts, and the 409 doesn't reveal whose bank it is.
  - set-merchant-rule and delete-category are scoped to the herd.
- **Data writes:**
  - Sync writes `herd_id` from the item, loads rules and custom transfer categories per herd, and snapshots all herd accounts.
- Pure-logic updates in `categories.ts` and tests (`planCategoryDelete` by herd).

**App**
- The upserts `onConflict 'user_id,category_id'` become `'herd_id,category_id'` (`queries.ts:350`, `:490`). Nothing else changes.

**RLS harness** (new, reusable): `scripts/rls-check.mjs`.
- It signs in as test users A (the existing test user), B and C. B and C are new, created with Pedro's OK.
- For every table and view it asserts who sees what, that forbidden writes change 0 rows or fail, and that the functions 404 on another herd.
- It prints PASS/FAIL and exits non-zero on any failure.
- It runs after every RLS migration, on dev.

---

## 9c: Herd membership

**Invites**
- `herd_invites(code unique, herd_id, created_by, expires_at +7d, accepted_by/at)`, readable by the herd and written only by the server.
- Codes are 8 characters in Crockford base32, shown as XXXX-XXXX.

**`herd` Edge Function** (logic in `_shared/herd.ts`, Deno-tested). Actions:
- `create_invite` and `revoke_invite` (owner);
- `preview_invite` (herd name and inviter's name);
- `join`;
- `leave`;
- `remove_member` (owner).

Join and leave call SQL functions in `public` whose `EXECUTE` is granted to service_role only, so each runs in one transaction.

**`merge_into_herd(user, target)`** (join). The joiner must be alone, the herd must have fewer than 6 members, and the code must be valid.
1. Move the joiner's custom categories to the target herd.
2. Move overrides and rules where they don't conflict; drop the rest.
3. Move budgets only if the target has none; otherwise drop them.
4. Update `plaid_items.herd_id`. The cascade moves everything else.
5. Hide the joiner's duplicate accounts and return them, so the app can prompt a disconnect.
6. Swap the membership (delete the old one, insert the new one) and delete the empty old herd.

**`leave_herd(user)`** (also used to remove a member):
1. Create the leaver's new herd.
2. Remap custom categories on the leaver's rows to their parent group. This must happen before the move, or the scope trigger rejects it.
3. Move their items. The cascade does the rest.
4. Accounts that stay in the herd and were owned by the leaver become Joint.
5. Swap the membership. If the owner leaves, the earliest-joined member becomes owner.

**App**
- `/herd` (from Settings): the herd name (owner can rename), members with initials avatars, Invite (the share sheet sends the code plus `tusky:///join/<code>`), pending invites, Leave or Remove.
- `/join` and `/join/[code]`:
  1. enter the code;
  2. preview the herd;
  3. choose which accounts to share (defaults to all);
  4. join, then handle any duplicate prompt.
- On the bank screen:
  - "Connected by X";
  - a Private switch, shown only to the person who connected the account;
  - reconnect and disconnect only for that person.
- Profiles become visible to herd mates.
- The query cache is cleared after joining or leaving.
- **Known v1 limit:** a signed-out user who opens an invite link loses the code, so the message includes the code as text too.

The harness is extended so that B joins A. B sees A's shared accounts but not the private account or its rows. C sees nothing. Leave moves the banks back.

---

## 9d: Who paid

**DB**
- `accounts.owner_id`: whose account it is; null means Joint.
  - New accounts default to the person who connected them, via a trigger; the owner is never in the sync upsert payload.
  - Any member can set it. A trigger checks that the owner is a herd member.
- `transactions.paid_by` and `paid_by_is_manual`.
  - Sync computes them like the category: keep a manual choice, otherwise use the account owner.
  - `carryForward` also carries a manual payer from pending to posted.
- An `AFTER UPDATE OF owner_id` trigger re-applies the owner to that account's non-manual rows.
- Grants: `update (owner_id)` on accounts, `update (paid_by, paid_by_is_manual)` on transactions.

**App**
- A new `components/ui/chips.tsx`: member names plus Joint.
- "Whose account?" on the bank screen.
- A "Who paid" row on the review card and the transaction screen.
- All of it is hidden when the herd has one member.
- A pure `payerLabel` (a name, Joint, or Former member), covered by tests.

---

## Later (not planned in detail)

- Split transactions and settle-up ("Kelvyn owes Pedro").
- Spending by person in Reports, and a payer filter on the feed.
- Invite links that survive signup.
- In-app account deletion (Play requires it before a public release).
- Custom SMTP for prod email.
- **Billing is per herd.** Update the Stripe spec, which today keys `subscriptions` on `user_id`, and the monetization doc, which lists "share with a partner" as a paid feature. Member limits are enforced in the `herd` function.

## Verification (every milestone)

- Tests: Deno (`npx -y deno test supabase/functions/_shared/`) and `npm test`, then `npm run typecheck && npx expo lint`.
- `db push --dry-run` first. Grant checks with `has_column_privilege`.
- For 9b, 9c and 9d, `scripts/rls-check.mjs` must be all PASS on dev before any push to prod. Also run Supabase's security advisors.
- One scripted emulator pass per milestone:
  - 9a: sign up with a name and edit it;
  - 9b: a regression pass over the feed, budgets, reports, rules and review;
  - 9c: invite, join and leave across two test users on the emulator and the phone;
  - 9d: set the payer on a card.
- Track P: a function call on prod as Pedro, with 200s and no 401 or 500, plus one real non-OAuth bank linked and synced.
- For each milestone: a handoff doc, a memory update, and a PR. Pedro merges.
