-- Phase 12d: Jev decisions. Every column here is written only by sync's Jev
-- passes (service_role). None is ever in sync's upsert payload — a bulk upsert
-- sends the union of the rows' keys — and the app never writes any of them.

-- How sure Jev was of a cached answer, and at which level of the tree it
-- answered. Null on rows cached by 12b's Haiku, which reported no confidence.
alter table public.ai_category_cache
  add column confidence numeric check (confidence between 0 and 1),
  add column level text check (level in ('child', 'group'));

alter table public.transactions
  -- Copied from the answer that set an `ai` category, and kept when the user
  -- fixes it: cat-quality.mjs reads both sides to calibrate JEV_CONFIDENCE.
  add column ai_confidence numeric check (ai_confidence between 0 and 1),
  add column ai_level text check (ai_level in ('child', 'group')),
  -- Review triage: 0 routine, 1 worth a glance, 2 likely needs a fix.
  add column review_priority smallint check (review_priority between 0 and 2),
  -- Looks like a shared expense. A hint only: it never writes `split`.
  add column split_suggested boolean;

comment on column public.transactions.review_priority is
  'Jev review triage (12d): 0 routine, 1 worth a glance, 2 likely needs a fix; null = not judged.';
comment on column public.transactions.split_suggested is
  'Jev hint (12d, shared herds only): looks like a shared expense. Never writes split.';

-- No grants on purpose. The table-level SELECT that authenticated has had on
-- transactions since Phase 6 already covers these columns, and no client may
-- write them: there is no UPDATE grant. ai_category_cache stays server-only.
