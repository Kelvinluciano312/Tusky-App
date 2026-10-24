# Coordination

Pedro (GitHub [DahVincis](https://github.com/DahVincis)) and Kelvyn (GitHub [Kelvinluciano312](https://github.com/Kelvinluciano312)) share this repo, often with AI coding agents. Follow these rules so the two of you do not collide.

## Rules

1. **Pull requests only.** Do not push directly to `master`. Every change goes through a pull request.
2. **Look before you start.** Check open pull requests, open issues, and recent commits on `master`.
3. **Claim the work.** Open an issue, or comment on an existing one, before you start, so the other person knows.
4. **Branch prefixes.** Pedro's branches are `pedro/...`. Kelvyn's branches are `kelvyn/...`. An AI agent working for someone uses that person's prefix. Do not create a branch named exactly `pedro` or `kelvyn`: Git stores that name as a file and then refuses every `pedro/...` or `kelvyn/...` branch.
5. **Stay off files another open pull request already touches.** If you must edit them, coordinate in the issue or pull request first.
6. **Keep the heads-up current.** Update [In progress / heads-up](#in-progress--heads-up) when you start, change, or finish work: who, what, branch or pull request, and the rough area or files.

## Connect GitHub to Cursor

Install the [Cursor GitHub app](https://github.com/apps/cursor) on this repository so cloud agents can read the repo and open pull requests.

A Cursor account admin does this from [dashboard Integrations](https://cursor.com/dashboard/integrations): **Connect** next to GitHub, then grant this repository (all repositories, or this one only). Details: [Cursor's GitHub docs](https://cursor.com/docs/integrations/github).

## Suggested repo settings

Recommendations only. This file does not change any repository settings.

Turn on branch protection for `master`:

- Require a pull request before merging.
- Require 1 approving review.

## In progress / heads-up

Update this table when you pick up or finish work. Leave a row blank when nothing is in flight.

| Who | What | Branch / PR | Area / files |
| --- | --- | --- | --- |
| Pedro | Password reset: https universal link / App Link, and the recovery email button | `pedro/reset-app-links`, issue [#74](https://github.com/Kelvinluciano312/Tusky-App/issues/74) | `apps/mobile/src/lib/recovery.ts`, `apps/mobile/src/app/+native-intent.tsx`, `apps/mobile/app.json`, `scripts/build-auth-emails.mjs`, `supabase/templates/recovery.html`, `docs/ops/production.md` |
