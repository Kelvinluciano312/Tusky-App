-- Phase 12a: the labels learning reads, capped in the database. Only the most
-- recent p_limit labels per merchant and direction are ever used, and a plain
-- select of every label would grow without bound and be cut silently at
-- PostgREST's max_rows. Server-only: Edge Functions call it with the service key.

create function public.merchant_labels(p_herd uuid, p_keys text[], p_limit int)
returns table (
  merchant_key text,
  amount numeric,
  category_id uuid,
  date date,
  user_id uuid,
  is_private boolean
)
language sql
stable
set search_path = ''
as $$
  select l.merchant_key, l.amount, l.category_id, l.date, l.user_id, l.is_private
  from (
    select t.merchant_key, t.amount, t.category_id, t.date, t.user_id, a.is_private,
      row_number() over (partition by t.merchant_key, t.amount > 0 order by t.date desc, t.id desc) as n
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    where t.herd_id = p_herd
      and t.merchant_key = any (p_keys)
      and t.category_id is not null
      and (
        t.category_is_manual
        -- An accepted guess (GUESSED_SOURCES in _shared/learn.ts) is a label too.
        or (t.category_source in ('learned', 'community', 'ai') and t.reviewed_at is not null)
      )
  ) l
  where l.n <= p_limit
$$;

revoke execute on function public.merchant_labels(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.merchant_labels(uuid, text[], int) to service_role;
