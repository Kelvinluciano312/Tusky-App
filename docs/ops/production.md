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
- **The functions are NOT deployed yet.** Claude's permission check blocks production deploys, so Pedro runs the command above.
- No users yet.
