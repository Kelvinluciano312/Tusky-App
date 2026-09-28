-- Phase 14b: the daily plan check. pg_cron calls the plan-enforcer Edge
-- Function with a shared secret. Both values live in Vault, created per
-- project by hand (docs/ops/production.md), never in the repo. Without them
-- the URL is null and the call fails harmlessly: nothing is enforced.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'plan-enforcer',
  '0 9 * * *',
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
