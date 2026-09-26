-- Phase 12a: where each transaction's category came from, and which source a
-- user's fix corrected. Sync and set-merchant-rule write category_source; this
-- trigger stamps 'manual' whenever a user picks a category, so the app's direct
-- update (useSetTransactionCategory) never names it. corrected_from is what the
-- quality measure (scripts/cat-quality.mjs) counts.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

alter table public.transactions
  add column category_source text not null default 'plaid'
    check (category_source in ('manual', 'rule', 'learned', 'community', 'ai', 'plaid', 'fallback')),
  add column corrected_from text
    check (corrected_from in ('rule', 'learned', 'community', 'ai', 'plaid', 'fallback'));

-- Backfill before the trigger exists. corrected_from starts null: past fixes
-- never recorded what they replaced.
update public.transactions set category_source = 'manual' where category_is_manual;
update public.transactions t set category_source = 'rule'
  from public.merchant_rules r
  where not t.category_is_manual and r.herd_id = t.herd_id
    and r.merchant_key = t.merchant_key and r.category_id = t.category_id;
update public.transactions t set category_source = 'fallback'
  where not t.category_is_manual and t.category_source = 'plaid'
    and t.pfc_primary is null and t.pfc_detailed is null
    and t.category_id = (select id from public.categories where slug = 'uncategorized' and herd_id is null);

create function public.transactions_category_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_is_manual and (
    tg_op = 'INSERT' or not old.category_is_manual or new.category_id is distinct from old.category_id
  ) then
    -- A different category over one Tusky set is a correction of that source.
    if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id and old.category_source <> 'manual' then
      new.corrected_from := old.category_source;
    end if;
    new.category_source := 'manual';
  end if;
  return new;
end;
$$;

-- "ad_": after aa_fill_herd_id, ab_transactions_paid_by and ac_transactions_split.
create trigger ad_transactions_category_source
  before insert or update of category_id, category_is_manual on public.transactions
  for each row execute function public.transactions_category_source();

-- No grant: authenticated already selects the whole table, and its update
-- grants are column-scoped, so neither new column is client-writable.
