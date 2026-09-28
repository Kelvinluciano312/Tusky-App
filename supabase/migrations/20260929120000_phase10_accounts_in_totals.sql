-- Phase 10: count an account in totals, or not. A 401k or a brokerage stays
-- visible, with its transactions, but leaves net worth and its history. Not
-- the same as `hidden`, which removes the account from everything.

alter table public.accounts add column in_totals boolean not null default true;

grant update (in_totals) on public.accounts to authenticated;

-- The history chart follows the flag, backwards too, so the line always ends
-- at the headline number. Same shape, filters and security as 9b's view.
create or replace view public.daily_net_worth
with (security_invoker = on) as
select
  s.date,
  sum(case when a.type in ('credit', 'loan') then -s.balance else s.balance end) as net_worth
from public.balance_snapshots s
join public.accounts a on a.id = s.account_id
where s.herd_id = (select private.my_herd_id())
  and not a.hidden
  and a.in_totals
group by s.date;
