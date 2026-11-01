/**
 * Read-only MCP finance connector (Streamable HTTP / JSON-RPC).
 * Auth is a long random bearer token whose SHA-256 hash is stored in
 * mcp_connector_tokens and mapped to a Tusky user. Visibility mirrors the app:
 * the viewer's herd, minus other members' private accounts (private.my_account_ids).
 * Pure helpers live here so Deno tests cover them without a live database.
 */

export type MemberTag = { user_id: string; display_name: string };

export type AccountRow = {
  id: string;
  user_id: string;
  owner_id: string | null;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string;
  hidden: boolean;
  in_totals: boolean;
  is_private: boolean;
};

export type TransactionRow = {
  id: string;
  account_id: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string;
  date: string;
  pending: boolean;
  category_id: string | null;
  paid_by: string | null;
};

export type SnapshotRow = {
  id: string;
  account_id: string;
  date: string;
  balance: number;
};

export type StreamRow = {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  merchant_key: string;
  direction: string;
  category_id: string | null;
  frequency: string;
  average_amount: number;
  last_amount: number;
  last_date: string;
  next_date: string;
  dismissed: boolean;
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string | null;
  kind: string;
  parent_id: string | null;
  herd_id: string | null;
};

export type BudgetRow = {
  id: string;
  category_id: string;
  amount: number;
};

export type ProfileRow = { user_id: string; display_name: string };

export type HerdMemberRow = { user_id: string; role: string };

/** Minimal store the Edge Function fills with the service-role client. */
export type FinanceStore = {
  lookupToken(tokenHash: string): Promise<{ user_id: string } | null>;
  getHerd(userId: string): Promise<{ herd_id: string; role: string } | null>;
  listHerdMembers(herdId: string): Promise<HerdMemberRow[]>;
  listProfiles(userIds: string[]): Promise<ProfileRow[]>;
  listAccounts(herdId: string): Promise<AccountRow[]>;
  listSnapshots(accountIds: string[], from?: string, to?: string): Promise<SnapshotRow[]>;
  listTransactions(args: {
    accountIds: string[];
    from?: string;
    to?: string;
    accountId?: string;
    categoryId?: string;
    categoryIds?: string[];
    limit: number;
    cursorDate?: string;
    cursorId?: string;
  }): Promise<TransactionRow[]>;
  listCategories(herdId: string): Promise<CategoryRow[]>;
  listBudgets(herdId: string): Promise<BudgetRow[]>;
  listStreams(accountIds: string[]): Promise<StreamRow[]>;
};

export type Scope = {
  viewerId: string;
  herdId: string;
  role: string;
  members: Map<string, string>;
  visibleAccounts: AccountRow[];
  visibleAccountIds: string[];
};

const HEX64 = /^[0-9a-f]{64}$/;

/** Pull the bearer token; null when missing or empty. */
export function bearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Lowercase hex SHA-256 of the raw token. Never log the input. */
export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const dig = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isTokenHash(value: string): boolean {
  return HEX64.test(value);
}

/**
 * Same rule as private.my_account_ids: herd accounts that are not private, or
 * that the viewer themselves connected.
 */
export function accountVisibleToViewer(
  account: { is_private: boolean; user_id: string },
  viewerId: string,
): boolean {
  return !account.is_private || account.user_id === viewerId;
}

export function filterVisibleAccounts(accounts: AccountRow[], viewerId: string): AccountRow[] {
  return accounts.filter((a) => accountVisibleToViewer(a, viewerId));
}

export function memberTag(
  userId: string | null | undefined,
  members: Map<string, string>,
): MemberTag | null {
  if (!userId) return null;
  return { user_id: userId, display_name: members.get(userId) ?? 'Unknown' };
}

/** Who "owns" a transaction for tagging: spent-by, else the account connector. */
export function transactionMemberId(
  tx: { paid_by: string | null },
  account: { user_id: string; owner_id: string | null } | undefined,
): string | null {
  if (tx.paid_by) return tx.paid_by;
  if (!account) return null;
  return account.owner_id ?? account.user_id;
}

export function withMember<T extends object>(
  row: T,
  userId: string | null | undefined,
  members: Map<string, string>,
): T & { member: MemberTag | null } {
  return { ...row, member: memberTag(userId, members) };
}

export type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: 'list_herd_members',
    description:
      'List members of the authenticated user\'s herd (user_id, display_name, role). Membership is the consent to share non-private accounts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_accounts',
    description:
      'Accounts and balances visible to the token owner (herd accounts minus other members\' private ones). Each row is tagged with its connecting member.',
    inputSchema: {
      type: 'object',
      properties: {
        include_hidden: { type: 'boolean', description: 'Include hidden accounts. Default false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_balance_history',
    description: 'Daily balance snapshots for visible accounts, optionally filtered by date range and account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Limit to one visible account id.' },
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_transactions',
    description:
      'Transactions on visible accounts (date, amount, merchant, category). Keyset-paginated newest first. Amount sign: positive = money in.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD.' },
        account_id: { type: 'string' },
        category_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size, default 50, max 200.' },
        cursor_date: { type: 'string', description: 'Keyset cursor date from the previous page.' },
        cursor_id: { type: 'string', description: 'Keyset cursor id from the previous page.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'monthly_category_totals',
    description:
      'Sum of transaction amounts per category per calendar month over a date range, for visible non-hidden accounts. Positive = income.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD (required).' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD (required).' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_recurring',
    description: 'Detected recurring bills and subscriptions (recurring_streams) on visible accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        include_dismissed: { type: 'boolean', description: 'Include user-dismissed streams. Default false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_income',
    description:
      'Income summary and recent income transactions (categories with kind=income) on visible accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max income rows, default 50.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_categories',
    description: 'Built-in and this herd\'s custom categories.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_budgets',
    description: 'Herd budgets (amount intended to spend per category). Herd-shared config, no per-member privacy.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function toolResult(data: unknown): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function toolError(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function asObject(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asLimit(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(200, Math.max(1, Math.floor(v)));
}

function monthKey(date: string): string {
  return date.slice(0, 7) + '-01';
}

export async function resolveScope(store: FinanceStore, viewerId: string): Promise<Scope | null> {
  const herd = await store.getHerd(viewerId);
  if (!herd) return null;
  const memberRows = await store.listHerdMembers(herd.herd_id);
  const profiles = await store.listProfiles(memberRows.map((m) => m.user_id));
  const members = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  for (const m of memberRows) {
    if (!members.has(m.user_id)) members.set(m.user_id, 'Unknown');
  }
  const accounts = filterVisibleAccounts(await store.listAccounts(herd.herd_id), viewerId);
  return {
    viewerId,
    herdId: herd.herd_id,
    role: herd.role,
    members,
    visibleAccounts: accounts,
    visibleAccountIds: accounts.map((a) => a.id),
  };
}

export async function callTool(
  name: string,
  rawParams: unknown,
  scope: Scope,
  store: FinanceStore,
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  const params = asObject(rawParams);
  const byId = new Map(scope.visibleAccounts.map((a) => [a.id, a]));

  try {
    switch (name) {
      case 'list_herd_members': {
        const rows = [...scope.members.entries()].map(([user_id, display_name]) => ({
          user_id,
          display_name,
          is_viewer: user_id === scope.viewerId,
        }));
        return toolResult({ herd_id: scope.herdId, members: rows });
      }
      case 'list_accounts': {
        const includeHidden = asBool(params.include_hidden, false);
        const rows = scope.visibleAccounts
          .filter((a) => includeHidden || !a.hidden)
          .map((a) =>
            withMember(
              {
                id: a.id,
                name: a.name,
                official_name: a.official_name,
                mask: a.mask,
                type: a.type,
                subtype: a.subtype,
                current_balance: a.current_balance,
                available_balance: a.available_balance,
                iso_currency_code: a.iso_currency_code,
                hidden: a.hidden,
                in_totals: a.in_totals,
                is_private: a.is_private,
                owner_id: a.owner_id,
              },
              a.user_id,
              scope.members,
            ),
          );
        return toolResult({ accounts: rows });
      }
      case 'list_balance_history': {
        const accountId = asString(params.account_id);
        if (accountId && !byId.has(accountId)) return toolError('account_id is not visible to this token');
        const ids = accountId ? [accountId] : scope.visibleAccountIds;
        const snaps = await store.listSnapshots(ids, asString(params.from), asString(params.to));
        const rows = snaps.map((s) =>
          withMember(
            { id: s.id, account_id: s.account_id, date: s.date, balance: s.balance },
            byId.get(s.account_id)?.user_id,
            scope.members,
          ),
        );
        return toolResult({ snapshots: rows });
      }
      case 'list_transactions': {
        const accountId = asString(params.account_id);
        if (accountId && !byId.has(accountId)) return toolError('account_id is not visible to this token');
        const limit = asLimit(params.limit, 50);
        const txs = await store.listTransactions({
          accountIds: scope.visibleAccountIds,
          from: asString(params.from),
          to: asString(params.to),
          accountId,
          categoryId: asString(params.category_id),
          limit,
          cursorDate: asString(params.cursor_date),
          cursorId: asString(params.cursor_id),
        });
        // Drop anything on a hidden account unless explicitly requested by account_id.
        const rows = txs
          .filter((t) => {
            const a = byId.get(t.account_id);
            if (!a) return false;
            if (accountId) return true;
            return !a.hidden;
          })
          .map((t) =>
            withMember(
              {
                id: t.id,
                account_id: t.account_id,
                date: t.date,
                amount: t.amount,
                name: t.name,
                merchant_name: t.merchant_name,
                category_id: t.category_id,
                pending: t.pending,
                iso_currency_code: t.iso_currency_code,
                paid_by: t.paid_by,
              },
              transactionMemberId(t, byId.get(t.account_id)),
              scope.members,
            ),
          );
        const last = rows[rows.length - 1];
        const next_cursor =
          rows.length === limit && last ? { cursor_date: last.date, cursor_id: last.id } : null;
        return toolResult({ transactions: rows, next_cursor });
      }
      case 'monthly_category_totals': {
        const from = asString(params.from);
        const to = asString(params.to);
        if (!from || !to) return toolError('from and to are required (YYYY-MM-DD)');
        const visibleNonHidden = scope.visibleAccounts.filter((a) => !a.hidden).map((a) => a.id);
        const txs = await store.listTransactions({
          accountIds: visibleNonHidden,
          from,
          to,
          limit: 10000,
        });
        type Agg = {
          month: string;
          category_id: string | null;
          iso_currency_code: string;
          total: number;
          transaction_count: number;
        };
        const map = new Map<string, Agg>();
        for (const t of txs) {
          const month = monthKey(t.date);
          const key = `${month}|${t.category_id ?? ''}|${t.iso_currency_code}`;
          const cur = map.get(key) ?? {
            month,
            category_id: t.category_id,
            iso_currency_code: t.iso_currency_code,
            total: 0,
            transaction_count: 0,
          };
          cur.total += Number(t.amount);
          cur.transaction_count += 1;
          map.set(key, cur);
        }
        const totals = [...map.values()].sort((a, b) =>
          a.month === b.month
            ? (a.category_id ?? '').localeCompare(b.category_id ?? '')
            : a.month.localeCompare(b.month),
        );
        return toolResult({ from, to, totals });
      }
      case 'list_recurring': {
        const includeDismissed = asBool(params.include_dismissed, false);
        const streams = await store.listStreams(scope.visibleAccountIds);
        const rows = streams
          .filter((s) => {
            const a = byId.get(s.account_id);
            if (!a || a.hidden) return false;
            return includeDismissed || !s.dismissed;
          })
          .map((s) =>
            withMember(
              {
                id: s.id,
                account_id: s.account_id,
                name: s.name,
                merchant_key: s.merchant_key,
                direction: s.direction,
                category_id: s.category_id,
                frequency: s.frequency,
                average_amount: s.average_amount,
                last_amount: s.last_amount,
                last_date: s.last_date,
                next_date: s.next_date,
                dismissed: s.dismissed,
              },
              s.user_id,
              scope.members,
            ),
          );
        return toolResult({ recurring: rows });
      }
      case 'list_income': {
        const cats = await store.listCategories(scope.herdId);
        const incomeIds = cats.filter((c) => c.kind === 'income').map((c) => c.id);
        const limit = asLimit(params.limit, 50);
        const visibleNonHidden = scope.visibleAccounts.filter((a) => !a.hidden).map((a) => a.id);
        if (incomeIds.length === 0 || visibleNonHidden.length === 0) {
          return toolResult({ summary_by_month: [], transactions: [] });
        }
        const incomeTxs = await store.listTransactions({
          accountIds: visibleNonHidden,
          from: asString(params.from),
          to: asString(params.to),
          categoryIds: incomeIds,
          limit,
        });
        const byMonth = new Map<string, number>();
        for (const t of incomeTxs) {
          const m = monthKey(t.date);
          byMonth.set(m, (byMonth.get(m) ?? 0) + Number(t.amount));
        }
        return toolResult({
          summary_by_month: [...byMonth.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, total]) => ({ month, total })),
          transactions: incomeTxs.map((t) =>
            withMember(
              {
                id: t.id,
                account_id: t.account_id,
                date: t.date,
                amount: t.amount,
                name: t.name,
                merchant_name: t.merchant_name,
                category_id: t.category_id,
                pending: t.pending,
                iso_currency_code: t.iso_currency_code,
              },
              transactionMemberId(t, byId.get(t.account_id)),
              scope.members,
            ),
          ),
        });
      }
      case 'list_categories': {
        const cats = await store.listCategories(scope.herdId);
        return toolResult({
          categories: cats.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            kind: c.kind,
            parent_id: c.parent_id,
            is_custom: c.herd_id != null,
            member: null,
            herd_shared: true,
          })),
        });
      }
      case 'list_budgets': {
        const [budgets, cats] = await Promise.all([
          store.listBudgets(scope.herdId),
          store.listCategories(scope.herdId),
        ]);
        const names = new Map(cats.map((c) => [c.id, c.name]));
        return toolResult({
          budgets: budgets.map((b) => ({
            id: b.id,
            category_id: b.category_id,
            category_name: names.get(b.category_id) ?? null,
            amount: b.amount,
            member: null,
            herd_shared: true,
          })),
        });
      }
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool_failed';
    return toolError(message);
  }
}

export function initializeResult(): Record<string, unknown> {
  return {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    serverInfo: { name: 'tusky-finance', version: '1.0.0' },
  };
}

/**
 * Handle one JSON-RPC MCP message after auth. Returns the JSON body and HTTP status.
 * Notifications (no id) get 202 with null body.
 */
export async function handleJsonRpc(
  body: JsonRpcRequest,
  scope: Scope,
  store: FinanceStore,
): Promise<{ status: number; body: unknown | null }> {
  const method = typeof body.method === 'string' ? body.method : '';
  const id = body.id;
  const isNotification = id === undefined || id === null;

  if (body.jsonrpc !== '2.0') {
    return {
      status: 400,
      body: { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request' } },
    };
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return { status: 202, body: null };
  }

  if (isNotification) {
    return { status: 202, body: null };
  }

  if (method === 'initialize') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: initializeResult() } };
  }
  if (method === 'ping') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
  }
  if (method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: TOOLS } } };
  }
  if (method === 'tools/call') {
    const params = asObject(body.params);
    const name = asString(params.name);
    if (!name) {
      return {
        status: 200,
        body: { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call requires params.name' } },
      };
    }
    const result = await callTool(name, params.arguments ?? {}, scope, store);
    return { status: 200, body: { jsonrpc: '2.0', id, result } };
  }

  return {
    status: 200,
    body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } },
  };
}
