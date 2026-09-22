# Tusky

A personal finance app — connect your banks, see your net worth, track spending, and budget by category. Built as a mobile-first app in the spirit of Monarch Money, with a future twist: community-informed transaction categorization.

## Status

- ✅ **Phase 0** — Expo app scaffold, Tusky theme (forest-ink/tusk-ivory, Fraunces + Figtree + IBM Plex Mono), auth, 5-tab shell
- ✅ **Phase 1** — Plaid Link end-to-end: connect a sandbox bank, accounts + net worth on Home
- ✅ **Phase 2** — transaction sync (cursor-based), categorized feed with manual overrides, reconnect via Link update mode
- ✅ **Phase 2.5** — Plaid webhooks: verified public endpoint, background sync on new data, broken logins flagged without a manual sync
- ✅ **Phase 3** — budgets per category, spending-by-category donut and cash-flow reports
- 🚧 **Phase 4 (next)** — net worth history (nothing records balances over time yet)
- Planned: recurring transactions, category groups

## Architecture

```text
apps/mobile/     Expo (React Native) app — expo-router, React Query, Supabase client
supabase/        Postgres migrations + Edge Functions (all Plaid API calls live here)
legacy/          The previous Vite web demo + Plaid quickstart (reference only)
```

- **Backend**: Supabase — Auth, Postgres with row-level security, and Edge Functions. Plaid access tokens live in `plaid_tokens`, a table with no client policies or grants; only Edge Functions (service role) touch Plaid.
- **Bank data**: Plaid (Sandbox during development). Sandbox test login inside Plaid Link: `user_good` / `pass_good`.

## Getting started

Prereqs: Node 20+, JDK 17, Android SDK (Android Studio, or `cmdline-tools` alone) with an emulator or a physical Android phone, a [Supabase project](https://supabase.com), and a [Plaid](https://dashboard.plaid.com) account (Sandbox keys).

> ⚠️ **On Windows, clone to a short path without spaces, outside OneDrive** (e.g. `C:\dev\Tusky-App`). Native Android builds fail inside synced folders and long/spaced paths (ninja/CMake limits). No such restriction on Linux or macOS.

**On Linux**, also export `ANDROID_HOME=$HOME/Android/Sdk` with `$ANDROID_HOME/platform-tools` on your `PATH`, accept the SDK licenses (`sdkmanager --licenses`), and make sure `/dev/kvm` is accessible for the emulator (`sudo usermod -aG kvm $USER`, then re-login). See `CLAUDE.md` → Platform notes for the full list.

```sh
cd apps/mobile
npm install
cp .env.example .env          # fill in your Supabase URL + anon key
npx expo run:android          # native dev build — Expo Go won't work (Plaid Link is a native module)
```

**Multiple devices:** `expo run:android` builds only the target device's CPU architecture. Target explicitly when switching between an emulator and a phone, e.g. `npx expo run:android --device Pixel_7` (x86_64 emulator) vs. your arm64 phone — each device needs its own matching install.

### Backend deploy

```sh
npx supabase login                                   # once
npx supabase link --project-ref <your-project-ref>   # once
npx supabase db push                                  # apply migrations
npx supabase secrets set --env-file supabase/functions/.env   # PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV
npx supabase functions deploy plaid-create-link-token plaid-exchange-token --use-api
```

Also register your Android package name (`com.tusky.app`) under **Allowed Android package names** in the Plaid dashboard (API settings), or native Link will refuse to open.

## Repo conventions

- Secrets never enter git: app-side config in `apps/mobile/.env` (only `EXPO_PUBLIC_*` values — URL and anon key); Plaid secrets in `supabase/functions/.env`, pushed via `supabase secrets set`.
- Database changes are versioned migrations in `supabase/migrations/`.
- Every monetary amount in the UI renders through the `Amount` component (IBM Plex Mono, tabular, dimmed cents) — the "ledger voice".
