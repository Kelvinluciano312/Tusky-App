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

`PLAID_CLIENT_ID`, `PLAID_SECRET` (production) and `PLAID_ENV=production`. Pedro or Kelvyn enter `PLAID_SECRET` in the dashboard themselves (Edge Functions → Secrets); it never goes through chat or a file in the repo. Supabase provides its own keys to functions automatically (`SUPABASE_SECRET_KEYS`, which `getAdminClient` reads).

## Settings outside the repo

- **Auth:** email confirmation is OFF while only Pedro and Kelvyn use it. Turn it ON before anyone else gets access.
- **Plaid dashboard (Kelvyn):** `com.tusky.app` is under Developers → API → Allowed Android package names. Big OAuth banks wait on Plaid's production approval.
- **Backups:** the Free plan has none. Optional: a periodic `db dump` to a folder outside the repo.

## The app

`apps/mobile/.env` holds both projects: `EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY` (dev) and `EXPO_PUBLIC_PROD_SUPABASE_URL/_KEY` (production, publishable key). `lib/environment.ts` picks one at launch:

- **Dev builds** switch in Settings → Data (dev build), or on the sign-in screen. Switching restarts the app. Each project keeps its own sign-in. A red REAL DATA pill shows while a dev build is on production.
- **Release builds** always use production.

Restart Metro after editing `.env`.

## State (2026-09-28)

- All 18 migrations (through 9d) are applied.
- The three Plaid secrets are set.
- 8 functions are deployed, all except `plaid-sandbox`.
  - Checked without a session: `herd` and `plaid-create-link-token` answer 401, `plaid-webhook` refuses an unsigned call, and `plaid-sandbox` is 404.
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
