import { assertEquals } from 'jsr:@std/assert';

import {
  accountVisibleToViewer,
  bearerToken,
  callTool,
  filterVisibleAccounts,
  handleJsonRpc,
  hashToken,
  isTokenHash,
  memberTag,
  resolveScope,
  TOOLS,
  transactionMemberId,
  withMember,
  type AccountRow,
  type FinanceStore,
  type Scope,
  type TransactionRow,
} from './mcp-finance.ts';

const PEDRO = '11111111-1111-1111-1111-111111111111';
const ANNIE = '22222222-2222-2222-2222-222222222222';
const OUTSIDER = '33333333-3333-3333-3333-333333333333';
const HERD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function account(over: Partial<AccountRow> & Pick<AccountRow, 'id' | 'user_id'>): AccountRow {
  return {
    name: 'Checking',
    official_name: null,
    mask: '1234',
    type: 'depository',
    subtype: 'checking',
    current_balance: 100,
    available_balance: 90,
    iso_currency_code: 'USD',
    hidden: false,
    in_totals: true,
    is_private: false,
    owner_id: over.user_id,
    ...over,
  };
}

function memScope(accounts: AccountRow[]): Scope {
  return {
    viewerId: PEDRO,
    herdId: HERD,
    role: 'owner',
    members: new Map([
      [PEDRO, 'Pedro'],
      [ANNIE, 'Annie'],
    ]),
    visibleAccounts: accounts,
    visibleAccountIds: accounts.map((a) => a.id),
  };
}

function emptyStore(over: Partial<FinanceStore> = {}): FinanceStore {
  return {
    lookupToken: async () => null,
    getHerd: async () => ({ herd_id: HERD, role: 'owner' }),
    listHerdMembers: async () => [
      { user_id: PEDRO, role: 'owner' },
      { user_id: ANNIE, role: 'member' },
    ],
    listProfiles: async () => [
      { user_id: PEDRO, display_name: 'Pedro' },
      { user_id: ANNIE, display_name: 'Annie' },
    ],
    listAccounts: async () => [],
    listSnapshots: async () => [],
    listTransactions: async () => [],
    listCategories: async () => [],
    listBudgets: async () => [],
    listStreams: async () => [],
    ...over,
  };
}

Deno.test('bearerToken: only a non-empty Bearer value counts', () => {
  assertEquals(bearerToken('Bearer abc'), 'abc');
  assertEquals(bearerToken('Bearer  tok  '), 'tok');
  assertEquals(bearerToken('Bearer '), null);
  assertEquals(bearerToken('Basic abc'), null);
  assertEquals(bearerToken(null), null);
});

Deno.test('hashToken: stable lowercase hex of length 64', async () => {
  const a = await hashToken('test-token');
  const b = await hashToken('test-token');
  assertEquals(a, b);
  assertEquals(isTokenHash(a), true);
  assertEquals(a.length, 64);
  assertEquals(await hashToken('other') === a, false);
});

Deno.test('accountVisibleToViewer: mirrors private.my_account_ids', () => {
  assertEquals(accountVisibleToViewer({ is_private: false, user_id: ANNIE }, PEDRO), true);
  assertEquals(accountVisibleToViewer({ is_private: true, user_id: ANNIE }, PEDRO), false);
  assertEquals(accountVisibleToViewer({ is_private: true, user_id: PEDRO }, PEDRO), true);
  assertEquals(accountVisibleToViewer({ is_private: false, user_id: PEDRO }, PEDRO), true);
});

Deno.test('filterVisibleAccounts: drops another member\'s private accounts only', () => {
  const rows = [
    account({ id: 'a1', user_id: PEDRO, is_private: true }),
    account({ id: 'a2', user_id: ANNIE, is_private: true }),
    account({ id: 'a3', user_id: ANNIE, is_private: false }),
  ];
  assertEquals(
    filterVisibleAccounts(rows, PEDRO).map((a) => a.id),
    ['a1', 'a3'],
  );
});

Deno.test('memberTag and withMember attach display names', () => {
  const members = new Map([[PEDRO, 'Pedro']]);
  assertEquals(memberTag(PEDRO, members), { user_id: PEDRO, display_name: 'Pedro' });
  assertEquals(memberTag(ANNIE, members), { user_id: ANNIE, display_name: 'Unknown' });
  assertEquals(memberTag(null, members), null);
  assertEquals(withMember({ id: 1 }, PEDRO, members).member?.display_name, 'Pedro');
});

Deno.test('transactionMemberId: paid_by wins, else owner, else connector', () => {
  assertEquals(transactionMemberId({ paid_by: ANNIE }, { user_id: PEDRO, owner_id: PEDRO }), ANNIE);
  assertEquals(transactionMemberId({ paid_by: null }, { user_id: PEDRO, owner_id: ANNIE }), ANNIE);
  assertEquals(transactionMemberId({ paid_by: null }, { user_id: PEDRO, owner_id: null }), PEDRO);
  assertEquals(transactionMemberId({ paid_by: null }, undefined), null);
});

Deno.test('TOOLS: every tool has a name, description and object inputSchema', () => {
  assertEquals(TOOLS.length >= 8, true);
  for (const t of TOOLS) {
    assertEquals(typeof t.name, 'string');
    assertEquals(t.name.length > 0, true);
    assertEquals(typeof t.description, 'string');
    assertEquals((t.inputSchema as { type?: string }).type, 'object');
  }
});

Deno.test('resolveScope: only visible accounts enter the scope', async () => {
  const store = emptyStore({
    listAccounts: async () => [
      account({ id: 'mine-private', user_id: PEDRO, is_private: true }),
      account({ id: 'annie-private', user_id: ANNIE, is_private: true }),
      account({ id: 'annie-shared', user_id: ANNIE, is_private: false }),
      account({ id: 'outsider', user_id: OUTSIDER, is_private: false }), // still listed if in herd query; filter keeps it
    ],
  });
  const scope = await resolveScope(store, PEDRO);
  assertEquals(scope?.herdId, HERD);
  assertEquals(scope?.visibleAccountIds.sort(), ['annie-shared', 'mine-private', 'outsider'].sort());
  assertEquals(scope?.members.get(ANNIE), 'Annie');
});

Deno.test('list_accounts: tags connector and skips hidden by default', async () => {
  const accounts = [
    account({ id: 'a1', user_id: PEDRO, name: 'Mine', hidden: false }),
    account({ id: 'a2', user_id: ANNIE, name: 'Hers', hidden: true }),
  ];
  const result = await callTool('list_accounts', {}, memScope(accounts), emptyStore());
  assertEquals(result.isError, undefined);
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.accounts.length, 1);
  assertEquals(data.accounts[0].member, { user_id: PEDRO, display_name: 'Pedro' });
});

Deno.test('list_transactions: refuses an account outside the visible set', async () => {
  const result = await callTool(
    'list_transactions',
    { account_id: 'not-visible' },
    memScope([account({ id: 'a1', user_id: PEDRO })]),
    emptyStore(),
  );
  assertEquals(result.isError, true);
  assertEquals(result.content[0].text.includes('not visible'), true);
});

Deno.test('list_transactions: tags paid_by and paginates', async () => {
  const accounts = [account({ id: 'a1', user_id: PEDRO })];
  const txs: TransactionRow[] = [
    {
      id: 't2',
      account_id: 'a1',
      name: 'Pay',
      merchant_name: 'Acme',
      amount: -12,
      iso_currency_code: 'USD',
      date: '2026-10-02',
      pending: false,
      category_id: 'c1',
      paid_by: ANNIE,
    },
    {
      id: 't1',
      account_id: 'a1',
      name: 'Coffee',
      merchant_name: null,
      amount: -5,
      iso_currency_code: 'USD',
      date: '2026-10-01',
      pending: false,
      category_id: 'c1',
      paid_by: null,
    },
  ];
  const result = await callTool(
    'list_transactions',
    { limit: 1 },
    memScope(accounts),
    emptyStore({
      listTransactions: async ({ limit }) => txs.slice(0, limit),
    }),
  );
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.transactions.length, 1);
  assertEquals(data.transactions[0].member.display_name, 'Annie');
  assertEquals(data.next_cursor, { cursor_date: '2026-10-02', cursor_id: 't2' });
});

Deno.test('monthly_category_totals: aggregates by month and category', async () => {
  const accounts = [account({ id: 'a1', user_id: PEDRO })];
  const result = await callTool(
    'monthly_category_totals',
    { from: '2026-10-01', to: '2026-10-31' },
    memScope(accounts),
    emptyStore({
      listTransactions: async () => [
        {
          id: 't1',
          account_id: 'a1',
          name: 'A',
          merchant_name: null,
          amount: -10,
          iso_currency_code: 'USD',
          date: '2026-10-05',
          pending: false,
          category_id: 'food',
          paid_by: null,
        },
        {
          id: 't2',
          account_id: 'a1',
          name: 'B',
          merchant_name: null,
          amount: -5,
          iso_currency_code: 'USD',
          date: '2026-10-20',
          pending: false,
          category_id: 'food',
          paid_by: null,
        },
        {
          id: 't3',
          account_id: 'a1',
          name: 'Pay',
          merchant_name: null,
          amount: 1000,
          iso_currency_code: 'USD',
          date: '2026-10-01',
          pending: false,
          category_id: 'income',
          paid_by: null,
        },
      ],
    }),
  );
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.totals.length, 2);
  const food = data.totals.find((t: { category_id: string }) => t.category_id === 'food');
  assertEquals(food.total, -15);
  assertEquals(food.transaction_count, 2);
});

Deno.test('handleJsonRpc: initialize, tools/list, unknown method, notification', async () => {
  const scope = memScope([]);
  const store = emptyStore();

  const init = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, scope, store);
  assertEquals(init.status, 200);
  assertEquals((init.body as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'tusky-finance');

  const list = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, scope, store);
  assertEquals(((list.body as { result: { tools: unknown[] } }).result.tools).length, TOOLS.length);

  const missing = await handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }, scope, store);
  assertEquals((missing.body as { error: { code: number } }).error.code, -32601);

  const note = await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, scope, store);
  assertEquals(note.status, 202);
  assertEquals(note.body, null);
});

Deno.test('handleJsonRpc: tools/call list_herd_members', async () => {
  const scope = memScope([]);
  const res = await handleJsonRpc(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_herd_members', arguments: {} } },
    scope,
    emptyStore(),
  );
  const text = (res.body as { result: { content: { text: string }[] } }).result.content[0].text;
  const data = JSON.parse(text);
  assertEquals(data.herd_id, HERD);
  assertEquals(data.members.some((m: { display_name: string }) => m.display_name === 'Annie'), true);
});

Deno.test('list_balance_history: rejects foreign account ids', async () => {
  const result = await callTool(
    'list_balance_history',
    { account_id: 'x' },
    memScope([account({ id: 'a1', user_id: PEDRO })]),
    emptyStore(),
  );
  assertEquals(result.isError, true);
});

Deno.test('hashToken: empty string still hashes', async () => {
  assertEquals((await hashToken('')).length, 64);
});
