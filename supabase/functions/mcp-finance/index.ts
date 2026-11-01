/**
 * Read-only MCP finance connector (Streamable HTTP).
 * Authenticated by a long random bearer token whose SHA-256 hash is stored in
 * mcp_connector_tokens. verify_jwt is false; this function checks the token
 * itself. Never logs the raw token or any Plaid/2FA secrets.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { getAdminClient, loggable } from '../_shared/lib.ts';

/**
 * MCP clients are servers/agents, not browsers. Do not emit
 * Access-Control-Allow-Origin (especially not *). OPTIONS returns 204 with no
 * CORS advertisement.
 */
const MAX_BODY_BYTES = 64_000;

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

import {
  bearerToken,
  handleJsonRpc,
  hashToken,
  isTokenExpired,
  MCP_RATE_LIMIT_PER_DAY,
  MCP_RATE_LIMIT_PER_MINUTE,
  parseTakeRequestResult,
  resolveScope,
  shouldTouchLastUsed,
  type AccountRow,
  type BudgetRow,
  type CategoryRow,
  type ConnectorTokenRow,
  type FinanceStore,
  type HerdMemberRow,
  type JsonRpcRequest,
  type ProfileRow,
  type RateLimitDecision,
  type SnapshotRow,
  type StreamRow,
  type TransactionRow,
} from '../_shared/mcp-finance.ts';

const TX_COLUMNS =
  'id, account_id, name, merchant_name, amount, iso_currency_code, date, pending, category_id, paid_by';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function supabaseStore(admin: SupabaseClient): FinanceStore {
  return {
    async lookupToken(tokenHash) {
      const { data, error } = await admin
        .from('mcp_connector_tokens')
        .select('id, user_id, expires_at, last_used_at')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null)
        .maybeSingle();
      if (error) throw error;
      return data as ConnectorTokenRow | null;
    },

    async takeRequest(tokenId, maxPerMinute = MCP_RATE_LIMIT_PER_MINUTE, maxPerDay = MCP_RATE_LIMIT_PER_DAY) {
      const { data, error } = await admin.rpc('take_mcp_connector_request', {
        p_token_id: tokenId,
        p_max_per_minute: maxPerMinute,
        p_max_per_day: maxPerDay,
      });
      if (error) throw error;
      return parseTakeRequestResult(data);
    },

    async touchLastUsed(tokenId) {
      const { error } = await admin
        .from('mcp_connector_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', tokenId);
      if (error) throw error;
    },

    async recordToolUsage(usageId, tool, status) {
      if (!usageId) return;
      const { error } = await admin
        .from('mcp_connector_usage')
        .update({ tool, status })
        .eq('id', usageId);
      if (error) throw error;
    },

    async getHerd(userId) {
      const { data, error } = await admin
        .from('herd_members')
        .select('herd_id, role')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data as { herd_id: string; role: string } | null;
    },

    async listHerdMembers(herdId) {
      const { data, error } = await admin
        .from('herd_members')
        .select('user_id, role')
        .eq('herd_id', herdId);
      if (error) throw error;
      return (data ?? []) as HerdMemberRow[];
    },

    async listProfiles(userIds) {
      if (userIds.length === 0) return [];
      const { data, error } = await admin
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },

    async listAccounts(herdId) {
      const { data, error } = await admin
        .from('accounts')
        .select(
          'id, user_id, owner_id, name, official_name, mask, type, subtype, current_balance, available_balance, iso_currency_code, hidden, in_totals, is_private',
        )
        .eq('herd_id', herdId);
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },

    async listSnapshots(accountIds, from, to) {
      if (accountIds.length === 0) return [];
      let q = admin
        .from('balance_snapshots')
        .select('id, account_id, date, balance')
        .in('account_id', accountIds)
        .order('date', { ascending: true });
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SnapshotRow[];
    },

    async listTransactions(args) {
      if (args.accountIds.length === 0) return [];
      let q = admin
        .from('transactions')
        .select(TX_COLUMNS)
        .in('account_id', args.accountIds)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(args.limit);
      if (args.accountId) q = q.eq('account_id', args.accountId);
      if (args.categoryId) q = q.eq('category_id', args.categoryId);
      if (args.categoryIds && args.categoryIds.length > 0) q = q.in('category_id', args.categoryIds);
      if (args.from) q = q.gte('date', args.from);
      if (args.to) q = q.lte('date', args.to);
      if (args.cursorDate && args.cursorId) {
        // Values must already be validated as YYYY-MM-DD + UUID by callTool. Never
        // interpolate raw client strings into PostgREST `or` filters.
        q = q.or(
          `date.lt.${args.cursorDate},and(date.eq.${args.cursorDate},id.lt.${args.cursorId})`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TransactionRow[];
    },

    async listCategories(herdId) {
      // herdId comes from herd_members; still reject non-UUIDs before interpolating
      // into the PostgREST `or` filter string.
      if (!UUID_RE.test(herdId)) throw new Error('invalid_herd_id');
      const { data, error } = await admin
        .from('categories')
        .select('id, name, slug, kind, parent_id, herd_id')
        .or(`herd_id.is.null,herd_id.eq.${herdId}`)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },

    async listBudgets(herdId) {
      const { data, error } = await admin
        .from('budgets')
        .select('id, category_id, amount')
        .eq('herd_id', herdId);
      if (error) throw error;
      return (data ?? []) as BudgetRow[];
    },

    async listStreams(accountIds) {
      if (accountIds.length === 0) return [];
      const { data, error } = await admin
        .from('recurring_streams')
        .select(
          'id, account_id, user_id, name, merchant_key, direction, category_id, frequency, average_amount, last_amount, last_date, next_date, dismissed',
        )
        .in('account_id', accountIds)
        .order('next_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as StreamRow[];
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // MCP Streamable HTTP: POST only. A GET with no session is not supported.
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const token = bearerToken(req.headers.get('Authorization'));
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

  const contentLength = Number(req.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413);
  }

  let rpc: JsonRpcRequest;
  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload_too_large' }, 413);
    }
    rpc = JSON.parse(new TextDecoder().decode(raw)) as JsonRpcRequest;
  } catch {
    return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const admin = getAdminClient();
  const store = supabaseStore(admin);

  try {
    const tokenHash = await hashToken(token);
    const row = await store.lookupToken(tokenHash);
    // Same generic 401 for missing, revoked (filtered out), or expired.
    if (!row || isTokenExpired(row.expires_at)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let decision: RateLimitDecision;
    try {
      decision = await store.takeRequest(row.id);
    } catch (err) {
      // Rate-limit RPC failure must not open the gate; fail closed with 429.
      console.error('mcp-finance rate limit failed', loggable(err));
      return jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
    }
    if (!decision.allowed) {
      return jsonResponse(
        { error: 'rate_limited' },
        429,
        { 'Retry-After': String(decision.retryAfterSeconds) },
      );
    }

    if (shouldTouchLastUsed(row.last_used_at)) {
      void store.touchLastUsed(row.id).catch((err) => {
        console.error('mcp-finance last_used_at failed', loggable(err));
      });
    }

    const scope = await resolveScope(store, row.user_id);
    if (!scope) return jsonResponse({ error: 'no_herd' }, 500);

    const result = await handleJsonRpc(rpc, scope, store, { usageId: decision.usageId });
    if (result.body === null) {
      return new Response(null, { status: result.status });
    }
    return jsonResponse(result.body, result.status);
  } catch (err) {
    console.error('mcp-finance failed', loggable(err));
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
