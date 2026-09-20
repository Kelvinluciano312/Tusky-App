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
# backend (repo root; per machine, run `supabase login` + `link` once — see "First run")
npx supabase db push
npx supabase functions deploy <name> --use-api
npx supabase secrets set --env-file supabase/functions/.env
```

## Hard-won gotchas

- **Expo Go cannot run this app** (native Plaid SDK). Dev builds only.
- `expo run:android` builds ONLY the target device's ABI — an arm64 build crashes the x86_64 emulator with "Cannot find native module". Build per device.
- Unset `EXPO_PUBLIC_*` env vars arrive as `''`, not `undefined` — use `||` fallbacks, never `??`.
- Env vars bake into the JS bundle at Metro start — restart Metro after editing `.env`.
- **`options.transactions_url_taxonomy` does not work with `plaid@30`.** Plaid's current docs list it
  on `/transactions/sync`, but the API rejects it with `UNKNOWN_FIELDS` — the SDK pins an older
  `Plaid-Version`. The account's default PFC taxonomy applies instead; the `uncategorized` fallback in
  `_shared/categorize.ts` is what absorbs any primary we don't map. General lesson: Plaid docs describe
  the current API, not the version your SDK pins.
- **Supabase Free Plan pauses the project after ~7 days of inactivity.** Symptom: every request to
  `*.supabase.co` returns Cloudflare **521 web server is down** while `supabase.com` itself is fine —
  looks like a dead key or bad network, is neither. Fix: dashboard → **Resume project**. Data and config
  survive, restorable for up to 1 year.
- `android/` and `ios/` are gitignored; `expo run:android` regenerates them via prebuild. Never hand-edit them — native config belongs in `app.json` under `expo-build-properties` (that is where `minSdkVersion: 26`, required by Plaid SDK 6.0, lives), or it is wiped on the next prebuild.

## First run on a fresh clone

```sh
cd apps/mobile
npm install
cp .env.example .env     # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo run:android     # prebuild generates android/, then builds
```

Both `apps/mobile/.env` and `supabase/functions/.env` are gitignored and never travel with the repo — recreate them per machine (Supabase dashboard → Settings → API Keys; Plaid dashboard → Keys). The backend CLI also needs, once per machine:

```sh
npx supabase login
npx supabase link --project-ref ifibrsgqdibcomzxencf
```

## Platform notes

### Linux

- Prereqs: Node 20+, JDK 17, Android SDK. Export `ANDROID_HOME=$HOME/Android/Sdk`, put `$ANDROID_HOME/platform-tools` on `PATH`, and accept licenses (`sdkmanager --licenses`) or Gradle aborts.
- Emulator needs KVM: `ls /dev/kvm` must succeed. If it does not, `sudo usermod -aG kvm $USER` then log out and back in.
- Physical device: `adb devices` printing nothing or `unauthorized` is usually missing udev rules — install `android-udev-rules` (or add a rule for your vendor ID), then `adb kill-server && adb start-server`.
- Metro dying with `ENOSPC: System limit for number of file watchers reached` → raise the inotify limit:
  `echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system`
- Normal POSIX shell — the Windows caveats below do not apply.

### Windows

- Repo must live at a short, space-free, non-OneDrive path (e.g. `C:\dev\Tusky-App`), or ninja/CMake fails with "build.ninja still dirty".
- PowerShell 5.1: no `&&`; embedded `"` in `git commit -m` here-strings breaks arg passing (avoid double quotes in messages); binary output needs `adb pull`, never `>` redirection.

## Conventions

- All Plaid calls go through Edge Functions; the app never sees access tokens (`plaid_tokens` has zero client grants/policies).
- New tables: enable RLS, add `(select auth.uid()) = user_id` policies, and explicit `grant` to `authenticated` (new-cloud default does not auto-expose).
- Every monetary amount renders via `src/components/ui/amount.tsx` (mono "ledger voice"); text via `AppText` variants; colors/spacing only from `src/constants/theme.ts`.
- Plaid PFC category → our `category_id` mapping must never overwrite a user's manual category override (seed of the future community feature).
- Reconnecting a stale bank uses **Link update mode**: `plaid-create-link-token` takes an optional
  `item_id`, passes that Item's `access_token`, and OMITS `products` (Plaid rejects both together).
  There is no `/item/public_token/exchange` afterwards — the token does not change. A successful sync
  is what returns the Item to `active`, which is why `plaid-sync-transactions` selects
  `status in ('active','login_required')` rather than just active.
- `plaid-sandbox-reset-login` is **dev/test only**: it forces a real `ITEM_LOGIN_REQUIRED` so the
  reconnect path can be tested on demand. Two guards — the function 403s unless `PLAID_ENV=sandbox`,
  and the Settings button that calls it is behind `__DEV__` so it is stripped from release builds.
  Never expose it in production.
- Sandbox login inside Plaid Link: `user_good` / `pass_good`. Test app user: `ph.leao2099+tuskytest@gmail.com` (email confirmation is ON for new signups; confirm via admin API or dashboard).
