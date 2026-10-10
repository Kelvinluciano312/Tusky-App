-- Phase 16a: tighter bank limits and an hourly plan check.
-- Tusklet 3 -> 2 banks, trial 2 -> 1. Anyone over the new limit gets the
-- existing 7-day window (CHOOSE_DAYS), then loses the newest bank.
update public.plans set max_banks = 2 where id = 'tusklet';
update public.plans set max_banks = 1 where id = 'trial';

-- Plaid bills per Item per calendar month, so a lapsed trial's banks should go
-- within the hour, not up to a day later. Same job name as 14b: this replaces it.
select cron.schedule(
  'plan-enforcer',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/plan-enforcer',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  $$
);
