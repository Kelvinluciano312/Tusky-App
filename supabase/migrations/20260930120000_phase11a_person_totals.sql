-- Phase 11a: spending by person. The same monthly totals as
-- monthly_category_totals, one level finer: by whose expense it was
-- (transactions.paid_by, null = Joint). A separate view, so the budgets and the
-- donut keep reading theirs unchanged.
-- See docs/superpowers/specs/2026-09-26-phase-11-shared-money-design.md.

create view public.monthly_person_totals
with (security_invoker = on) as
select
  date_trunc('month', t.date::timestamp)::date as month,
  t.paid_by,
  t.category_id,
  t.iso_currency_code,
  sum(t.amount)  as total,
  count(*)::int  as transaction_count
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.herd_id = (select private.my_herd_id())
  and not a.hidden
group by 1, 2, 3, 4;

grant select on public.monthly_person_totals to authenticated;
