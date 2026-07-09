# Tusky — agent notes

Monarch-Money-style personal finance mobile app. Expo (React Native) + Supabase + Plaid Sandbox.
Approved plan/phases: see README Status; the full plan lives in the user's plan file (Phases 0–1 done, Phase 2 = transactions next).

## Layout

- `apps/mobile/` — Expo SDK 57 app (expo-router, file routes in `src/app/`). **Read `apps/mobile/AGENTS.md` before writing Expo code** — SDK 57 APIs differ from training data.
- `supabase/migrations/` — versioned SQL. `supabase/functions/` — Deno Edge Functions (`npm:` imports); shared helpers in `functions/_shared/lib.ts`.
- `legacy/` — old Vite web demo + Flask Plaid quickstart. Reference only; never build on it.

## Commands

```sh
# app (run inside apps/mobile)
npm run typecheck && npx expo lint      # run both before committing
npx expo run:android --device Pixel_7   # emulator (x86_64); omit --device for default target
# backend (repo root; CLI is logged in + linked to project ifibrsgqdibcomzxencf)
npx supabase db push
npx supabase functions deploy <name> --use-api
npx supabase secrets set --env-file supabase/functions/.env
```

## Hard-won gotchas

- **Expo Go cannot run this app** (native Plaid SDK). Dev builds only.
- `expo run:android` builds ONLY the target device's ABI — an arm64 build crashes the x86_64 emulator with "Cannot find native module". Build per device.
- Repo must live at a short, space-free, non-OneDrive path (currently `C:\dev\Tusky-App`), or ninja/CMake fails with "build.ninja still dirty".
- Unset `EXPO_PUBLIC_*` env vars arrive as `''`, not `undefined` — use `||` fallbacks, never `??`.
- PowerShell 5.1 here: no `&&`; embedded `"` in `git commit -m` here-strings breaks arg passing (avoid double quotes in messages); binary output needs `adb pull`, never `>` redirection.
- Env vars bake into the JS bundle at Metro start — restart Metro after editing `.env`.

## Conventions

- All Plaid calls go through Edge Functions; the app never sees access tokens (`plaid_tokens` has zero client grants/policies).
- New tables: enable RLS, add `(select auth.uid()) = user_id` policies, and explicit `grant` to `authenticated` (new-cloud default does not auto-expose).
- Every monetary amount renders via `src/components/ui/amount.tsx` (mono "ledger voice"); text via `AppText` variants; colors/spacing only from `src/constants/theme.ts`.
- Plaid PFC category → our `category_id` mapping must never overwrite a user's manual category override (seed of the future community feature).
- Sandbox login inside Plaid Link: `user_good` / `pass_good`. Test app user: `ph.leao2099+tuskytest@gmail.com` (email confirmation is ON for new signups; confirm via admin API or dashboard).
