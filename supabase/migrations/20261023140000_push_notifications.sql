-- Push notifications.
--
-- push_tokens: one Expo token per device. The signed-in user registers and
-- removes their own through register_push_token / unregister_push_token, which
-- move a token to the current user so a shared phone does not keep the
-- previous person's row. Account deletion removes them: user_id cascades from
-- auth.users.
--
-- notification_prefs: one row per user, created when they choose. Missing row
-- means the defaults below. Timezone is null until the app has seen the device.
-- Reconnect alerts are not a column: they always send.
--
-- notification_log: server-only. A row per (user, dedupe key) stops a repeat.
-- sent_at null and deliver_after set means "waiting for quiet hours" (or a
-- retry). The hourly job sends those and deletes rows older than 90 days.
--
-- Triggers on questions call send-push through pg_net. Without Vault secrets
-- project_url and push_secret the trigger does nothing, and a failed post
-- never fails the ask or the answer.
--
-- login_required_at marks when a bank entered login_required, so the reminder
-- is three days after that transition and a repair can start the clock again.

alter table public.plaid_items
  add column login_required_at timestamptz;

comment on column public.plaid_items.login_required_at is
  'When status last became login_required. Cleared when a sync returns the Item to active. The 3-day reconnect reminder reads it.';

create index plaid_items_login_required_idx
  on public.plaid_items (login_required_at)
  where status = 'login_required';

-- ── Tokens ─────────────────────────────────────────────────────────────────
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
comment on table public.push_tokens is
  'Expo push tokens. Register and remove go through the functions below; the send path reads them as service_role.';

alter table public.push_tokens enable row level security;

create policy "Users see their own push tokens" on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users delete their own push tokens" on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.push_tokens to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;

-- ── Preferences ────────────────────────────────────────────────────────────
create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text,
  question_asked boolean not null default true,
  question_answered boolean not null default true,
  review_digest boolean not null default true,
  review_threshold int not null default 10 check (review_threshold in (5, 10, 20)),
  review_hour int not null default 19 check (review_hour between 0 and 23),
  herd_joined boolean not null default true,
  settle_nudge boolean not null default false,
  budget_80 boolean not null default false,
  budget_100 boolean not null default true,
  weekly_recap boolean not null default true,
  large_transaction boolean not null default false,
  large_cents int not null default 50000 check (large_cents between 100 and 100000000),
  upcoming_bill boolean not null default false,
  price_change boolean not null default true,
  trial_ending boolean not null default true,
  billing_issue boolean not null default true,
  quiet_start int not null default 22 check (quiet_start between 0 and 23),
  quiet_end int not null default 8 check (quiet_end between 0 and 23),
  hide_amounts boolean not null default false,
  prompted_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.notification_prefs is
  'Per-user push preferences. A missing row is the defaults. prompted_at set means the onboarding step or the Home card has already asked.';

create trigger notification_prefs_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

alter table public.notification_prefs enable row level security;

create policy "Users see their notification prefs" on public.notification_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users create their notification prefs" on public.notification_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users change their notification prefs" on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.notification_prefs to service_role;

-- ── Log ────────────────────────────────────────────────────────────────────
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  title text not null,
  body text not null,
  url text not null,
  sound boolean not null default true,
  channel text not null default 'default',
  urgent boolean not null default false,
  sent_at timestamptz,
  deliver_after timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notification_log_due_idx
  on public.notification_log (deliver_after)
  where sent_at is null;
comment on table public.notification_log is
  'One row per user and dedupe key. sent_at null means not delivered yet. No client access.';

alter table public.notification_log enable row level security;
-- No policies: authenticated sees nothing. service_role bypasses RLS and is granted below.
grant select, insert, update, delete on public.notification_log to service_role;
revoke all on public.notification_log from anon, authenticated;

-- ── Registering a device ───────────────────────────────────────────────────
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'bad_platform';
  end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 255 or p_token <> btrim(p_token) then
    raise exception 'bad_token';
  end if;
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values ((select auth.uid()), p_token, p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.push_tokens
  where token = p_token and user_id = (select auth.uid());
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ── Questions ──────────────────────────────────────────────────────────────
-- pg_net only sends after the transaction commits, and a missing secret or a
-- down function must not roll back the ask.
create function private.enqueue_push(p_event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := jsonb_build_object('events', jsonb_build_array(p_event)),
    timeout_milliseconds := 5000
  );
exception when others then
  return;
end;
$$;

revoke all on function private.enqueue_push(jsonb) from public, anon, authenticated;

create function private.notify_question_asked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_push(jsonb_build_object('kind', 'question_asked', 'question_id', new.id));
  return null;
end;
$$;

revoke all on function private.notify_question_asked() from public, anon, authenticated;

create trigger al_transaction_questions_push
  after insert on public.transaction_questions
  for each row execute function private.notify_question_asked();

create function private.notify_question_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.answered_by is not null or new.answered_by is null then
    return null;
  end if;
  perform private.enqueue_push(jsonb_build_object('kind', 'question_answered', 'transaction_id', new.id));
  return null;
end;
$$;

revoke all on function private.notify_question_answered() from public, anon, authenticated;

create trigger al_transactions_question_answered
  after update of answered_by on public.transactions
  for each row execute function private.notify_question_answered();

-- ── Spend for budget alerts and the weekly recap ───────────────────────────
-- Service role only. security invoker, so a later grant to authenticated would
-- still pass through RLS. Aggregating here avoids PostgREST's row cap, which
-- would under-count a busy month. Private rows are tagged with the connector;
-- the sender drops them for shared budget alerts and keeps a person's own for
-- their recap. A group budget includes its children's rows (parent_id).
create function public.notification_category_spend(p_herd uuid, p_start date, p_end date)
returns table (
  category_id uuid,
  parent_id uuid,
  category_name text,
  connector_id uuid,
  is_private boolean,
  spent numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.category_id,
    c.parent_id,
    c.name,
    a.user_id,
    a.is_private,
    sum(-t.amount)::numeric
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  join public.categories c on c.id = t.category_id
  where t.herd_id = p_herd
    and not t.pending
    and not a.hidden
    and t.date >= p_start
    and t.date < p_end
    and t.amount < 0
    and c.kind = 'expense'
  group by t.category_id, c.parent_id, c.name, a.user_id, a.is_private;
$$;

revoke all on function public.notification_category_spend(uuid, date, date) from public, anon, authenticated;
grant execute on function public.notification_category_spend(uuid, date, date) to service_role;

-- ── Hourly job ─────────────────────────────────────────────────────────────
-- Minute 5, so it does not start in the same second as plan-enforcer (minute 0).
-- Without project_url and cron_secret in Vault the job posts nothing useful
-- and the function answers 401.
select cron.schedule(
  'notifications-cron',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/notifications-cron',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  $$
);
