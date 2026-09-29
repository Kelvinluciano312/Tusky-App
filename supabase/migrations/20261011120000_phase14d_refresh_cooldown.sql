-- Phase 14d: plan-refresh's per-user cooldown. Written only by plan-refresh
-- (service role); the table-level select grant lets the app read it, which is harmless.
alter table public.subscriptions add column refreshed_at timestamptz;
