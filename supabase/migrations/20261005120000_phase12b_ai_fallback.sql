-- Phase 12b: the AI fallback. An opt-in switch per user, and one global cache
-- of the model's answers.
--
-- The cache is deliberately global and has no herd_id: the model only ever sees
-- merchant-level text and the built-in category list, so an answer is correct
-- for every herd. That is the whole bargain — a merchant one subscriber pays to
-- resolve is then free, and already categorized, for everyone. Private rows are
-- kept out of it in code (applyAnswers), because which merchants someone keeps
-- private is not a fact other herds get to learn.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

alter table public.profiles
  add column ai_categorize boolean not null default false;

grant update (ai_categorize) on public.profiles to authenticated;

create table public.ai_category_cache (
  -- merchant|direction|band, built by cacheKeyFor in _shared/ai.ts.
  cache_key text primary key,
  category_id uuid not null references public.categories (id),
  created_at timestamptz not null default now()
);

-- RLS on with no policy: deny-all to every client, reachable only by
-- service_role, exactly like plaid_tokens. No grants are issued on purpose.
alter table public.ai_category_cache enable row level security;
