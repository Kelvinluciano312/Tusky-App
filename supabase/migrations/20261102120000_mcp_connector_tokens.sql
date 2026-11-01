-- Read-only MCP finance connector tokens.
-- Stores only SHA-256 hex hashes of long random bearer tokens, mapped to the
-- user whose herd visibility the connector may read. Plaintext never lands in
-- the database. No client grants: Edge Functions reach this as service_role
-- only (same pattern as community_labels / plaid_tokens).

create table public.mcp_connector_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Lowercase hex of SHA-256(token). Unique so one hash never maps to two users.
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'investment-guy'
    check (label = btrim(label) and length(label) between 1 and 64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index mcp_connector_tokens_user_id_idx
  on public.mcp_connector_tokens (user_id)
  where revoked_at is null;

alter table public.mcp_connector_tokens enable row level security;
-- RLS on, no policies: deny-all for roles that are subject to RLS.
-- service_role bypasses RLS; grant it explicitly for the Oct 30 Data API change.

revoke all on table public.mcp_connector_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.mcp_connector_tokens to service_role;
