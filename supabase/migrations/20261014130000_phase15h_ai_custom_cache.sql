-- Phase 15h: Jev's answers about a herd's own categories (_shared/custom-ai.ts).
-- Per herd, never global: custom category names are the herd's own. The key
-- carries the custom set that was offered, so a new category asks again. A null
-- category_id means "keep what the row has", remembered so no later sync pays
-- to ask again. Server-only: RLS on, no policies, no grants.

create table public.ai_custom_cache (
  herd_id uuid not null references public.herds (id) on delete cascade,
  cache_key text not null,
  category_id uuid references public.categories (id) on delete cascade,
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (herd_id, cache_key)
);

alter table public.ai_custom_cache enable row level security;
