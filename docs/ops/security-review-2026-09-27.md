# Security review — 2026-09-27

A full pass over the app, the database and the server functions, on both the dev project
(`ifibrsgqdibcomzxencf`) and production (`awiwcgrisyzimzxgddxu`). The bar is the one the data sets:
Tusky holds people's bank balances and transaction history.

Everything below was verified against the live projects, not read off the migrations. Live write
probes ran inside rolled-back blocks on dev only.

## Status (2026-09-27, same day)

| # | Finding | State |
| --- | --- | --- |
| 1 | Session tokens in AsyncStorage | **Fixed** — moved to the keystore, verified on device |
| 2 | Leaked-password protection off | Open — dashboard toggle, both projects |
| 3 | Email confirmation off on production | Open — deliberate until a third person signs up |
| 4 | `set_updated_at` search_path | **Fixed** — migration `20261004120000` |
| 5 | Webhook key-fetch amplification | **Fixed** — negative cache + kid shape check |
| 6 | npm advisories in build tooling | Open — no runtime exposure |
| 7 | `rls_auto_enable` | No action — verified inert |
| 8 | Settlements trust model | No action — by design |

## Findings

Ordered by what a real attacker gets, not by how easy each is to fix.

### 1. Session tokens sit in unencrypted storage — HIGH — FIXED

`apps/mobile/src/lib/supabase.ts` gives supabase-js `storage: AsyncStorage`. On Android that is a
plain SQLite file in the app's private directory. It holds the **refresh token**, which is
long-lived and can be exchanged for account access indefinitely.

`expo-secure-store` is already a dependency, and the same file uses it — for
`tusky.backend`, the dev-only "which project am I pointed at" preference. The UI preference is in
the hardware-backed keystore and the bank-account session is not.

App sandboxing keeps other apps out, so this needs a rooted or compromised device, or a backup
extraction. That is exactly the threat model a finance app is supposed to survive.

**Fixed.** `lib/secure-storage.ts` is a storage adapter over `expo-secure-store`. Android's keystore
rejects values over roughly 2 KB and a Supabase session is bigger, so a value is split across
numbered keys behind a manifest; a missing chunk reads as signed out rather than as a truncated
token, and every path swallows keystore errors so a broken keystore signs the user out instead of
crashing the app. Sessions written by older builds are moved across on first read and deleted from
AsyncStorage. The chunking is injected-backend and covered by nine tests in `npm test`.

Verified on the emulator: after the change the app stayed signed in, and its AsyncStorage database
then held **no** `sb-*-auth-token` key and zero occurrences of `refresh_token`.

`android.allowBackup: false` is set in `app.json` under `expo-build-properties`. It is a native
manifest change, so it takes effect on the next `expo run:android`, not on a JS reload.

### 2. Leaked-password protection is off — MEDIUM

Both projects. Supabase can check new passwords against HaveIBeenPwned and refuse known-breached
ones. It is a dashboard toggle (Authentication → Policies) and costs nothing. Credential stuffing is
the most common way accounts like these are taken.

### 3. Email confirmation is off on production — MEDIUM (deliberate, but it must not ship)

Recorded in `docs/ops/production.md` as a temporary state while only Pedro and Kelvyn have accounts.
It means anyone who finds the project URL can create an account with an address they do not own. A
new account lands in its own empty herd and sees nobody else's data, so today the impact is junk
accounts rather than exposure — but this must be on before a third person signs up, together with
custom SMTP (the default sender only delivers to the org's own team).

### 4. `set_updated_at` has a mutable search_path — LOW — FIXED

The only function in `public` without `set search_path`. It is `SECURITY INVOKER`, so it runs as the
caller and is not a privilege-escalation path — which is why this is low and not high. Every other
function in the project is already hardened, including all three in `private`. Worth closing so the
advisor's list is empty and the next real one is not lost in noise.

### 5. The public webhook can be made to call Plaid — LOW — FIXED

`plaid-webhook` is the only unauthenticated endpoint. Its verification is sound (below), but
`getKey` in `supabase/functions/plaid-webhook/index.ts` caches only **successful** key fetches. An
unauthenticated caller can therefore send a fresh bogus `kid` on every request and make us hit
Plaid's `/webhook_verification_key/get` each time. No data is exposed and no request is ever
accepted; the cost is Plaid API rate limit and our own CPU.

**Fixed.** Both: a `kid` that is not a UUID never reaches Plaid, and a failed lookup is remembered
for 60 seconds. The window is short on purpose — Plaid retries a non-200 for 24 hours, so a key that
appears later is still picked up on the next delivery. Unsigned and bogus-`kid` requests were
re-tested against dev after deploying: both 401.

### 6. Five high-severity npm advisories, all in build tooling — INFO

`xmldom`, `js-yaml`, `brace-expansion`, `browserslist` and `image-size`, reached through
`@expo/config-plugins`, `@expo/prebuild-config` and `expo-splash-screen`. They are parsing and
denial-of-service issues in code that runs on a developer's machine at build time. **None of it
ships to the phone.** Worth an `npm audit fix` when Expo's versions allow, not worth forcing.

### 7. `rls_auto_enable` is executable by anon — INFO, no action

Production only; a Supabase-managed object behind their `ensure_rls` event trigger, not ours. The
advisor flags it because it is `SECURITY DEFINER` and `anon` holds EXECUTE. I called it as a
signed-in user: it returns without error and does nothing, because its only input is
`pg_event_trigger_ddl_commands()`, which is empty outside a DDL event. Not exploitable. Revoking
EXECUTE is optional hardening on an object Supabase owns and may recreate.

### 8. Either herd member can record a settlement "from" the other — INFO, by design

`settlements` lets any member insert a row naming either member as payer, so one member can assert
the other paid them. That is the intended two-person trust model and `rls-check` pins that it cannot
cross herds. Revisit if herds ever hold people who do not fully trust each other.

## What was verified and is sound

Recorded so the next review can start from here rather than re-deriving it.

**The client can reach almost nothing.**

- `anon` holds **zero** table grants in `public`, and neither `anon` nor `authenticated` has
  `BYPASSRLS`. An unauthenticated request reads nothing at all.
- RLS is enabled on all 17 tables. `plaid_tokens` and `plaid_detailed_map` have no policies at all —
  deny-all to every client, reachable only by `service_role`.
- The entire client write surface is column-scoped and is user-intent data only:
  `transactions(category_id, category_is_manual, notes, paid_by, paid_by_is_manual, reviewed_at, split)`,
  `accounts(hidden, in_totals, is_private, owner_id)`, `recurring_streams(dismissed)`,
  `profiles(display_name)`, `herds(name)`, plus the config tables. **No amount, balance, date,
  account_id or `category_source` is client-writable.**
- `budgets` and `category_overrides` do expose `herd_id` in their column grants, but the policies
  hold: moving a budget to another herd, inserting an override into another herd, and renaming
  another herd were all refused in a live probe.

**Isolation between households holds.**

- All five views carry `security_invoker = on`, so none of them runs as the owner and leaks past RLS.
- `private.my_herd_id`, `private.my_account_ids` and `private.is_herd_member` are `SECURITY DEFINER`
  with an empty `search_path`.
- Invites, memberships and profiles are each scoped to the caller's own herd — another herd's invite
  codes cannot be enumerated. `profiles` stores no email address, only a display name.
- `scripts/rls-check.mjs` passes for every user, now including six `replace_budgets` probes.

**The server functions are locked down.**

- Nine of the ten require a Supabase JWT. The tenth, `plaid-webhook`, is public by necessity and
  authenticates Plaid's own ES256 JWT first: algorithm pinned, key fetched by `kid`, expired keys
  refused, five-minute replay window, and the body hash compared in constant time against the raw
  bytes. Nothing runs before it passes.
- The three functions that take an `item_id` from the client — `plaid-create-link-token`,
  `plaid-disconnect-item`, `plaid-sandbox` — all check `.eq('user_id', user.id)` before touching an
  access token. No IDOR.
- `plaid-sandbox` refuses with 403 unless `PLAID_ENV=sandbox`, and it is not deployed to production.
- Access tokens never leave the server: `plaid_tokens` has no client grants of any kind.

**Secrets are clean.**

- No key material anywhere in the git history. The only tracked env files are `.example` templates,
  all with empty values. `.env` and `.env.*` are gitignored with an exception for `.example`.
- The only secrets in the app bundle are the project URL and the publishable key, which are designed
  to be public and are useless without a session because of the grants above.

## What is left

1. **Turn on leaked-password protection** on both projects: Authentication → Policies. A toggle,
   and the single best return left on this list.
2. **Before anyone else signs up:** email confirmation on, plus custom SMTP (finding 3).
3. `npm audit fix` when Expo's versions allow (finding 6). No hurry: none of it ships to the phone.
