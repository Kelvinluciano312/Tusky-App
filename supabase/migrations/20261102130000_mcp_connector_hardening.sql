-- MCP finance connector hardening: token expiry, last-used, usage audit, and
-- a service_role-only atomic rate-limit RPC. Same deny-all client posture as
-- mcp_connector_tokens (RLS on, no policies, no anon/authenticated grants).

-- ---------------------------------------------------------------------------
-- Token columns
-- ---------------------------------------------------------------------------
-- expires_at NULL = never expires (escape hatch). New mints should set a date.
-- Backfill: existing live tokens get 1 year from migration time so a stolen
-- bearer eventually dies without requiring an immediate rotate.
alter table public.mcp_connector_tokens
  add column expires_at timestamptz,
  add column last_used_at timestamptz;

update public.mcp_connector_tokens
set expires_at = now() + interval '1 year'
where revoked_at is null
  and expires_at is null;

comment on column public.mcp_connector_tokens.expires_at is
  'When set, the Edge Function rejects the bearer with the same generic 401 as a bad token. NULL means no expiry.';
comment on column public.mcp_connector_tokens.last_used_at is
  'Throttled touch from the Edge Function (at most about once a minute).';

-- ---------------------------------------------------------------------------
-- Usage / rate-limit log (no request params, no financial data)
-- ---------------------------------------------------------------------------
create table public.mcp_connector_usage (
  id bigint generated always as identity primary key,
  token_id uuid not null references public.mcp_connector_tokens (id) on delete cascade,
  called_at timestamptz not null default now(),
  -- Null for initialize / tools/list / ping / etc. Set for tools/call.
  tool text
    check (tool is null or (tool = btrim(tool) and length(tool) between 1 and 64)),
  status text not null
    check (status in ('ok', 'error', 'rate_limited'))
);

create index mcp_connector_usage_token_called_idx
  on public.mcp_connector_usage (token_id, called_at desc);

create index mcp_connector_usage_called_at_idx
  on public.mcp_connector_usage (called_at);

alter table public.mcp_connector_usage enable row level security;
-- RLS on, no policies: deny-all for roles subject to RLS.

revoke all on table public.mcp_connector_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.mcp_connector_usage to service_role;

comment on table public.mcp_connector_usage is
  'MCP finance connector request log for rate limits and tools/call audit. Never store args or money data.';

-- ---------------------------------------------------------------------------
-- Atomic take: reserve one request or return retry-after (cross-instance)
-- Defaults match the Edge Function constants: 60/min, 2000/day.
-- ---------------------------------------------------------------------------
create function public.take_mcp_connector_request(
  p_token_id uuid,
  p_max_per_minute int default 60,
  p_max_per_day int default 2000
)
returns table (
  allowed boolean,
  retry_after_seconds int,
  usage_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int;
  v_day int;
  v_oldest_min timestamptz;
  v_oldest_day timestamptz;
  v_id bigint;
  v_retry int;
begin
  if p_max_per_minute < 1 or p_max_per_day < 1 then
    raise exception 'invalid rate limit bounds';
  end if;

  -- Serialize per token so concurrent Edge isolates cannot overshoot.
  perform pg_advisory_xact_lock(hashtextextended(p_token_id::text, 0));

  select count(*)::int,
         min(called_at)
    into v_min, v_oldest_min
    from public.mcp_connector_usage
   where token_id = p_token_id
     and status <> 'rate_limited'
     and called_at > now() - interval '1 minute';

  select count(*)::int,
         min(called_at)
    into v_day, v_oldest_day
    from public.mcp_connector_usage
   where token_id = p_token_id
     and status <> 'rate_limited'
     and called_at > now() - interval '1 day';

  if v_min >= p_max_per_minute then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (v_oldest_min + interval '1 minute' - now())))::int
    );
    insert into public.mcp_connector_usage (token_id, status)
    values (p_token_id, 'rate_limited')
    returning id into v_id;
    return query select false, v_retry, v_id;
    return;
  end if;

  if v_day >= p_max_per_day then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (v_oldest_day + interval '1 day' - now())))::int
    );
    insert into public.mcp_connector_usage (token_id, status)
    values (p_token_id, 'rate_limited')
    returning id into v_id;
    return query select false, v_retry, v_id;
    return;
  end if;

  insert into public.mcp_connector_usage (token_id, status)
  values (p_token_id, 'ok')
  returning id into v_id;
  return query select true, 0, v_id;
end
$$;

revoke execute on function public.take_mcp_connector_request(uuid, int, int)
  from public, anon, authenticated;
grant execute on function public.take_mcp_connector_request(uuid, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Retention: drop usage rows older than 90 days (pg_cron already in this repo)
-- ---------------------------------------------------------------------------
select cron.schedule(
  'mcp-connector-usage-retention',
  '20 4 * * *',
  $$delete from public.mcp_connector_usage where called_at < now() - interval '90 days'$$
);
