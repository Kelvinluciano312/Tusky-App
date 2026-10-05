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

**RevenueCat (Phase 14c).** Production gets its own webhook in the same RevenueCat project, limited to the Play app, pointing at `https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/revenuecat-webhook` with its own Authorization value. Set `REVENUECAT_SECRET_KEY` (RevenueCat's v1 secret key) and `REVENUECAT_WEBHOOK_SECRET` (that Authorization value) with `secrets set --project-ref awiwcgrisyzimzxgddxu`, one at a time, never printed. Without the webhook secret every webhook is refused, which is the safe default. Store builds carry `EXPO_PUBLIC_PROD_REVENUECAT_KEY` (the `goog_` key) in the EAS `production` environment, so internal testers buy through Play's license testing (`docs/ops/release.md`). Production never accepts Test Store purchases: that needs `PLAID_ENV=sandbox`.

## Settings outside the repo

- **Auth:** email confirmation is OFF while only Pedro and Kelvyn use it. Turn it ON before anyone else gets access.
- **Plaid dashboard (Kelvyn):** `com.ouroborosstudios.tusky` is under Developers → API → Allowed Android package names. `plaid-create-link-token` sends this package name for native Android Link. Big OAuth banks wait on Plaid's production approval.
- **Backups:** the Free plan has none. Optional: a periodic `db dump` to a folder outside the repo.

## The app

`apps/mobile/.env` holds both projects: `EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY` (dev) and `EXPO_PUBLIC_PROD_SUPABASE_URL/_KEY` (production, publishable key). `lib/environment.ts` picks one at launch:

- **Dev builds** switch in Settings → Data (dev build), or on the sign-in screen. Switching restarts the app. Each project keeps its own sign-in. A red REAL DATA pill shows while a dev build is on production.
- **Release builds** always use production.

Restart Metro after editing `.env`.

## State (2026-10-01)

- All migrations through 14d are applied (12d–14d pushed 2026-10-01).
- Secrets set: the three Plaid secrets and `JEV_API_KEY`. **Not yet set:** `CRON_SECRET` with the Vault
  `cron_secret` and `project_url` (so the hourly `plan-enforcer` run does nothing yet),
  `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_SECRET` (so purchases are not granted yet).
- All 13 functions are deployed (2026-10-01), all except `plaid-sandbox`. `plaid-webhook`,
  `plan-enforcer` and `revenuecat-webhook` run with `verify_jwt = false` and check their own secret.
  - Claude's auto mode blocks production deploys unless Pedro allows `npx -y supabase@2.118.0 functions deploy` in `/permissions`.
- Pedro is signed up. His email was confirmed by SQL: the confirmation email arrived without a usable link.
- First real bank: Bread Savings, active, synced.

## Known issues

- **OAuth banks can return to a white screen (Android).** When Link hands off to the browser (the bank's own login) and comes back, Tusky showed a blank white screen, and no Item was saved. A second attempt connected at once, likely because the browser still held the approval and skipped the hop. Metro logged several fresh bundle loads during the attempt, which hints the app was restarted. Suspects:
  - Android killed Tusky while it was backgrounded, losing the Link session;
  - expo-router treats the return intent as a deep link to an unknown route.

  Diagnose with `adb logcat` on the phone (wireless adb, same Wi-Fi) during an OAuth link.
- **The confirmation email has no usable link.** Check Authentication → Email Templates (Confirm signup should contain `{{ .ConfirmationURL }}`) and the Site URL before Kelvyn signs up. Until then, confirm by SQL: `update auth.users set email_confirmed_at = now() where email = '…' and email_confirmed_at is null;`.
- **The default Supabase email only delivers to the org's team members.** Custom SMTP is needed before anyone else joins.
