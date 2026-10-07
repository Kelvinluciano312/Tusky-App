# Production (real data)

Two Supabase projects:

| | Dev / Sandbox | Production |
| --- | --- | --- |
| Project ref | `ifibrsgqdibcomzxencf` | `awiwcgrisyzimzxgddxu` |
| Organization | Pedro's | Ouroboros Studios |
| Plaid | Sandbox | Production (Kelvyn's keys) |
| Who | anyone testing | Pedro and Kelvyn only, ≤ 10 Items |

**The CLI stays linked to dev.** Never run `supabase init` or `supabase link` against production. Every production command names it with `--project-ref awiwcgrisyzimzxgddxu` (with `--linked` where the command needs it: the ref overrides the link for that one command and writes nothing). These commands run through Supabase's management API with the CLI login, so no database password and no IPv4 add-on is needed.

**Order: dev first, then production, and production only after Pedro's go-ahead.**

## Commands

```powershell
# Database: preview, then apply
npx -y supabase@2.118.0 db push --dry-run --linked --project-ref awiwcgrisyzimzxgddxu
npx -y supabase@2.118.0 db push --linked --project-ref awiwcgrisyzimzxgddxu

# Functions: every one EXCEPT plaid-sandbox (dev only; it also refuses unless PLAID_ENV=sandbox)
Get-ChildItem supabase/functions -Directory | Where-Object { $_.Name -notmatch '^_' -and $_.Name -ne 'plaid-sandbox' } |
  ForEach-Object { npx -y supabase@2.118.0 functions deploy $_.Name --project-ref awiwcgrisyzimzxgddxu --use-api }

# Read-only SQL
npx -y supabase@2.118.0 db query --linked --project-ref awiwcgrisyzimzxgddxu -o csv "select ..."

# Secrets: names and fingerprints only
npx -y supabase@2.118.0 secrets list --project-ref awiwcgrisyzimzxgddxu
```

## Secrets

`PLAID_CLIENT_ID`, `PLAID_SECRET` (production), `PLAID_ENV=production` and `JEV_API_KEY` (TypeSafe's Jev, which makes every AI decision since Phase 12d; without it the Jev passes are skipped silently and syncs are otherwise unaffected; `ANTHROPIC_API_KEY` is no longer read). Pedro or Kelvyn enter `PLAID_SECRET` in the dashboard themselves (Edge Functions → Secrets); it never goes through chat or a file in the repo. Supabase provides its own keys to functions automatically (`SUPABASE_SECRET_KEYS`, which `getAdminClient` reads).

**`label_pepper` (Vault, Phase 12c).** The HMAC key for `community_labels.contributor`, created once per project by SQL, never in the repo or chat: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'label_pepper', 'HMAC pepper for community_labels.contributor (Phase 12c)');`. Without it, contributions are silently skipped. Never rotate it: every contributor would split into two, and withdrawal could no longer find their old rows.

**Cron (Vault + function secret, Phase 14b).** The hourly `plan-enforcer` job reads two Vault secrets, `cron_secret` and `project_url`, and the function compares the header with its `CRON_SECRET`. Create both once per project, **before** the 14b migration is pushed; without them the cron call fails harmlessly and nothing is enforced. In Git Bash, so the value lives only in a shell variable and is never printed:

```sh
S=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") && npx -y supabase@2.118.0 db query --linked --project-ref awiwcgrisyzimzxgddxu "select vault.create_secret('$S', 'cron_secret', 'plan-enforcer cron secret (Phase 14b)')" >/dev/null && npx -y supabase@2.118.0 secrets set --project-ref awiwcgrisyzimzxgddxu CRON_SECRET="$S" >/dev/null && echo set
npx -y supabase@2.118.0 db query --linked --project-ref awiwcgrisyzimzxgddxu "select vault.create_secret('https://awiwcgrisyzimzxgddxu.supabase.co', 'project_url', 'This project''s URL, for cron jobs (Phase 14b)')"
```

**RevenueCat (Phase 14c).** Production gets its own webhook in the same RevenueCat project (`Tusky production`; the one named `Tusky` is dev's), limited to the Play app, pointing at `https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/revenuecat-webhook` with its own Authorization value. Set `REVENUECAT_SECRET_KEY` (RevenueCat's v1 secret key) and `REVENUECAT_WEBHOOK_SECRET` (that Authorization value) with `secrets set --project-ref awiwcgrisyzimzxgddxu`, one at a time, never printed. The Authorization value is a random string made for this (`openssl rand -hex 32`), pasted bare into RevenueCat: the function compares the whole header, so a `Bearer ` prefix fails with 401. Without the webhook secret every webhook is refused, which is the safe default. Store builds carry `EXPO_PUBLIC_PROD_REVENUECAT_KEY` (the `goog_` key) in the EAS `production` environment, so internal testers buy through Play's license testing (`docs/ops/release.md`). Production never accepts Test Store purchases: that needs `PLAID_ENV=sandbox`.

## Settings outside the repo

These are set per project, in dashboards. Dev and production both have them (2026-10-06).

- **Email (Resend).** Auth → SMTP Settings uses Resend (`smtp.resend.com`, port 465, user `resend`, the API key as password), sending as `noreply@studiosouroboros.com`. The domain is verified in Resend; its DKIM, SPF and DMARC records live in Cloudflare DNS, all DNS only. Supabase's own sender delivers only to the org's team members, so nobody else can sign up without this.
- **Auth → Sign In / Providers → Email:** email confirmation ON, minimum password length 12, requirements "Lowercase, uppercase letters, digits and symbols", Email OTP length 8 (`CODE_LENGTH` in the app must match).
- **Auth → Emails → Magic link or OTP:** the body shows `{{ .Token }}` and no link. The subject carries no code (it would show on a lock screen).
- **Auth → URL Configuration → Site URL:** `https://studiosouroboros.com/tusky/confirmed.html`. A confirmation link verifies at Supabase and then lands there. The default, `http://localhost:3000`, is a dead page and reads as spam. The page is in the Ouroboros-Inc repo (`public/tusky/confirmed.html`); it shows a "link didn't work" message when the address carries an error.
- **Plaid dashboard: allowed Android package names are per Plaid team.** `com.ouroborosstudios.tusky` must be under Developers → API → Allowed Android package names on the team that owns the keys in use: Kelvyn's team for production, Pedro's individual account for dev's Sandbox keys. Without it `/link/token/create` answers 400 `INVALID_FIELD` and `plaid-create-link-token` returns 500. Big OAuth banks wait on Plaid's production approval.
- **Backups:** the Free plan has none. Optional: a periodic `db dump` to a folder outside the repo.

## The app

`apps/mobile/.env` holds both projects: `EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY` (dev) and `EXPO_PUBLIC_PROD_SUPABASE_URL/_KEY` (production, publishable key). `lib/environment.ts` picks one at launch:

- **Dev builds** switch in Settings → Data (dev build), or on the sign-in screen. Switching restarts the app. Each project keeps its own sign-in. A red REAL DATA pill shows while a dev build is on production.
- **Release builds** always use production.

Restart Metro after editing `.env`.

## State (2026-10-06)

- All migrations through Phase 16e are applied (the five Phase 16 migrations pushed 2026-10-05, after #37–#39 merged).
  Since then, pushed 2026-10-06 after #45 and #46: `delete_personal_herd` (20261016120000) and the advisor fixes
  (20261016130000: the category-map policy and three `transactions` indexes). `db push --dry-run` reports up to date.
- Secrets set: the three Plaid secrets, `JEV_API_KEY`, `CRON_SECRET` (with the Vault `cron_secret` and
  `project_url`), `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_SECRET` (`secrets list`, 2026-10-06:
  names only, so present but not proven correct).
- The hourly `plan-enforcer` run is live: every hour it answers 202 and logs `2 judged, 0 acted`.
- All 14 functions are deployed (2026-10-06, from master at #41), everything except `plaid-sandbox`.
  Four were redeployed after #45 and #46: `delete-account`, `plaid-sync-transactions`, `plaid-webhook` and
  `two-factor`. They are deployed but not yet exercised on production. `two-factor` counts only
  `otp_expired` and `invalid_credentials` as a wrong code (confirmed on dev, not on production): any other
  Auth error answers 502, so try one wrong code on a real two-step sign-in.
  `plaid-webhook`, `plan-enforcer` and `revenuecat-webhook` run with `verify_jwt = false` and check
  their own secret.
  - Claude's auto mode blocks production deploys, pushes and queries unless Pedro allows them in `/permissions`; otherwise Pedro runs the command and Claude verifies with `db push --dry-run` and `functions list`.
- **Plaid errors no longer reach the logs whole (#41).** Before it, a failed Plaid call logged the SDK
  error with its request, `PLAID-SECRET` header included. Production's logs showed no such line in the
  24 hours before the fix, which is as far back as the log query reaches.
- **Email and Auth settings are in place and tested (2026-10-06)**, see "Settings outside the repo". On
  production, through the Auth API: three weak passwords were refused, a sign-up sent a confirmation
  email whose link redirects to the confirmed page, and a sign-in code arrived with 8 digits. Both came
  from `noreply@studiosouroboros.com`.
- Four accounts: Pedro (`tusk`, comp, one bank), and three on the signup trial (one with a bank, trial
  ends 2026-11-01; it will buy a plan, not be comped).
- First real bank: Bread Savings, active, synced.

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
cannot sign in or refresh a session; a session already open ends when its access token expires (1 hour by
default; the hosted value is the Auth JWT expiry setting in the dashboard). Lift it from the same menu.

What a ban does NOT do: their banks keep syncing through Plaid's webhooks, Plaid keeps billing for
them, and a store subscription keeps renewing. Stopping those needs code that does not exist yet
(a server-side suspend that removes their Items at Plaid). Until then, for abuse that costs money,
ask Pedro before touching their banks by hand.

## Known issues

- **OAuth banks can return to a white screen (Android).** When Link hands off to the browser (the bank's own login) and comes back, Tusky showed a blank white screen, and no Item was saved. A second attempt connected at once, likely because the browser still held the approval and skipped the hop. Metro logged several fresh bundle loads during the attempt, which hints the app was restarted. Suspects:
  - Android killed Tusky while it was backgrounded, losing the Link session;
  - expo-router treats the return intent as a deep link to an unknown route.

  Diagnose with `adb logcat` on the phone (wireless adb, same Wi-Fi) during an OAuth link.
- **No real RevenueCat event has reached production yet.** Production had no webhook until 2026-10-06:
  RevenueCat's only one pointed at dev, so a renewal would never have extended a row. `Tusky production`
  now exists (Play app, Production only, all events) with a fresh random `REVENUECAT_WEBHOOK_SECRET`,
  and RevenueCat's test event got 200 and logged `no_row` for its made-up user, so the secret matches.
  The purchase path is proven separately: with Pedro's row set to a trial, Restore purchases ran
  `plan-refresh`, which rewrote it to `tusk`, store `play`, ending when the paid period does (his row
  is a comp again). What is left is to see a real renewal or cancellation arrive and write a row.
- **Email can land in spam.** The sending domain is new. The first confirmation email went to Gmail's
  spam folder while its link still pointed at `localhost`; later ones reached the inbox, in a thread
  with one already marked not spam, so that is not clean proof. Watch the first outside sign-ups.
- **Gmail folds a repeat email.** A second identical email in the same thread shows as "Show quoted
  text", link hidden. It only affects someone who signs up or asks for a link twice.
