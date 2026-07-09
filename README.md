# Tusky

A personal finance app — connect your banks, see your net worth, track spending, and budget by category. Built as a mobile-first app in the spirit of Monarch Money, with a future twist: community-informed transaction categorization.

## Architecture

```text
apps/mobile/     Expo (React Native) app — expo-router, React Query, Supabase client
supabase/        Postgres migrations + Edge Functions (all Plaid API calls live here)
legacy/          The previous Vite web demo + Plaid quickstart (reference only)
```

- **Backend**: Supabase — Auth, Postgres with row-level security, and Edge Functions. Plaid access tokens are stored in a table no client can read; only Edge Functions (service role) touch Plaid.
- **Bank data**: Plaid (Sandbox during development). Transactions arrive via cursor-based `/transactions/sync`, triggered by pull-to-refresh, Plaid webhooks, and a daily cron.

## Getting started

Prereqs: Node 20+, Android Studio (emulator or a physical Android phone), a [Supabase project](https://supabase.com), and a [Plaid](https://dashboard.plaid.com) account (Sandbox keys).

```sh
cd apps/mobile
npm install
cp .env.example .env    # fill in your Supabase URL + anon key
npx expo run:android    # native dev build — Expo Go won't work (Plaid Link is a native module)
```

Plaid Sandbox test credentials inside Plaid Link: `user_good` / `pass_good`.

## Repo conventions

- Secrets never enter git: app-side config goes in `apps/mobile/.env` (only `EXPO_PUBLIC_*` values — URL and anon key); Plaid secrets go in Supabase Edge Function secrets (`supabase secrets set`).
- Database changes are versioned migrations in `supabase/migrations/`.
