import { assertEquals } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import type { AiCategory, AiRow } from './ai.ts';
import { loadCommunity, runAiPass } from './sync.ts';

// A fake PostgREST client. Every builder method records itself and returns the
// builder; awaiting the chain pops the next planned response for
// `<table>:<verb>`. Enough to pin what runAiPass reads, what it writes, and what
// it refuses to write — none of which the pure tests in ai.test.ts can reach.

type Resp = { data?: unknown; error?: unknown };
type Call = { table: string; verb: string; payload?: unknown; filters: unknown[][] };

function fakeAdmin(plan: Record<string, Resp[]>) {
  const calls: Call[] = [];

  const make = (table: string) => {
    let current: Call = { table, verb: '?', filters: [] };
    // deno-lint-ignore no-explicit-any
    const q: any = {};
    for (const verb of ['select', 'update', 'upsert', 'insert', 'delete']) {
      q[verb] = (payload?: unknown) => {
        current = { table, verb, payload, filters: [] };
        calls.push(current);
        return q;
      };
    }
    for (const filter of ['eq', 'in', 'is', 'not', 'or', 'neq', 'gt', 'lt']) {
      q[filter] = (...args: unknown[]) => {
        current.filters.push([filter, ...args]);
        return q;
      };
    }
    const resolve = (): Resp => {
      const queue = plan[`${table}:${current.verb}`];
      return queue && queue.length > 0 ? queue.shift()! : { data: null };
    };
    q.maybeSingle = () => Promise.resolve(resolve());
    q.single = q.maybeSingle;
    // deno-lint-ignore no-explicit-any
    q.then = (onOk: any, onErr: any) => Promise.resolve(resolve()).then(onOk, onErr);
    return q;
  };

  return {
    admin: { from: (table: string) => make(table) } as unknown as SupabaseClient,
    calls,
    of: (table: string, verb: string) => calls.filter((c) => c.table === table && c.verb === verb),
  };
}

const ITEM = { id: 'item-1', user_id: 'user-1', herd_id: 'herd-1' };

const CATEGORY_ROWS = [{ id: 'c-fuel', slug: 'gas', name: 'Gas', parent_id: 'g-transport' }];
const GROUP_ROWS = [{ id: 'g-transport', name: 'Transportation' }];

const txRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 't1',
  merchant_key: 'shell',
  name: 'SHELL OIL 4412',
  merchant_name: 'Shell',
  amount: -48.2,
  pfc_primary: 'TRANSPORTATION',
  pfc_detailed: null,
  accounts: { is_private: false },
  ...over,
});

/** The reads runAiPass makes, in order, once it is past the profile gate. */
function readPlan(rows: unknown[], cache: unknown[] = []): Record<string, Resp[]> {
  return {
    'profiles:select': [{ data: { ai_categorize: true } }],
    'transactions:select': [{ data: rows }],
    'ai_category_cache:select': [{ data: cache }],
    'categories:select': [{ data: CATEGORY_ROWS }, { data: GROUP_ROWS }],
  };
}

const withKey = async (body: () => Promise<void>) => {
  const had = Deno.env.get('ANTHROPIC_API_KEY');
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-test');
  try {
    await body();
  } finally {
    if (had === undefined) Deno.env.delete('ANTHROPIC_API_KEY');
    else Deno.env.set('ANTHROPIC_API_KEY', had);
  }
};

const answerGas = (rows: AiRow[], _cats: AiCategory[]) =>
  Promise.resolve(rows.map((r) => ({ key: `${r.merchant_key}|out|2`, slug: 'gas' })));

Deno.test('runAiPass: a user who has not opted in is never sent anywhere', async () => {
  await withKey(async () => {
    const { admin, calls, of } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: false } }] });
    let asked = false;
    const set = await runAiPass(admin, ITEM, () => {
      asked = true;
      return Promise.resolve([]);
    });
    assertEquals(set, 0);
    assertEquals(asked, false);
    // Not even read: the switch is checked before anything is loaded.
    assertEquals(of('transactions', 'select').length, 0);
    assertEquals(calls.filter((c) => c.verb === 'update' || c.verb === 'upsert').length, 0);
  });
});

Deno.test('runAiPass: answers are written grouped, stamped `ai`, and only over rows still not manual', async () => {
  await withKey(async () => {
    const rows = [txRow({ id: 't1' }), txRow({ id: 't2', amount: -49 })];
    const { admin, of } = fakeAdmin(readPlan(rows));
    const set = await runAiPass(admin, ITEM, answerGas);

    assertEquals(set, 2);
    const writes = of('transactions', 'update');
    // One statement for both rows, not one each.
    assertEquals(writes.length, 1);
    assertEquals(writes[0].payload, { category_id: 'c-fuel', category_source: 'ai' });
    assertEquals(writes[0].filters, [
      ['in', 'id', ['t1', 't2']],
      // A row someone categorized by hand between the read and the write stays put.
      ['eq', 'category_is_manual', false],
    ]);
  });
});

Deno.test('runAiPass: a private account\'s merchant never reaches the global cache', async () => {
  await withKey(async () => {
    const rows = [txRow({ id: 'p1', accounts: { is_private: true } })];
    const { admin, of } = fakeAdmin(readPlan(rows));
    const set = await runAiPass(admin, ITEM, answerGas);

    // The row still gets its category.
    assertEquals(set, 1);
    assertEquals(of('transactions', 'update').length, 1);
    // But which merchants someone keeps private is not a fact other herds learn.
    assertEquals(of('ai_category_cache', 'upsert').length, 0);
  });
});

Deno.test('runAiPass: a shared answer is cached, and a merchant the model declined is cached as null', async () => {
  await withKey(async () => {
    const rows = [txRow({ id: 't1' }), txRow({ id: 't2', merchant_key: 'mystery', name: 'POS DEBIT 88213' })];
    const { admin, of } = fakeAdmin(readPlan(rows));
    const set = await runAiPass(admin, ITEM, (asked) =>
      // Answers the first, declines the second — as the prompt tells it to.
      Promise.resolve(asked.filter((r) => r.merchant_key === 'shell').map((r) => ({
        key: `${r.merchant_key}|out|2`,
        slug: 'gas',
      }))));

    assertEquals(set, 1);
    const cached = of('ai_category_cache', 'upsert');
    assertEquals(cached.length, 1);
    assertEquals(cached[0].payload, [
      { cache_key: 'shell|out|2', category_id: 'c-fuel' },
      // Without this row, the same unanswerable merchant is sent again every sync.
      { cache_key: 'mystery|out|2', category_id: null },
    ]);
  });
});

Deno.test('runAiPass: a cached null answer costs nothing and asks nothing', async () => {
  await withKey(async () => {
    const rows = [txRow({ id: 't1' })];
    const { admin, of } = fakeAdmin(
      readPlan(rows, [{ cache_key: 'shell|out|2', category_id: null }]),
    );
    let asked = false;
    const set = await runAiPass(admin, ITEM, () => {
      asked = true;
      return Promise.resolve([]);
    });
    assertEquals(asked, false);
    assertEquals(set, 0);
    assertEquals(of('transactions', 'update').length, 0);
    // Already known: nothing to write back.
    assertEquals(of('ai_category_cache', 'upsert').length, 0);
  });
});

Deno.test('runAiPass: a model that fails costs the sync nothing', async () => {
  await withKey(async () => {
    const { admin, calls } = fakeAdmin(readPlan([txRow()]));
    const set = await runAiPass(admin, ITEM, () => Promise.reject(new Error('402 out of credit')));
    // A missed category is never worth failing a sync over.
    assertEquals(set, 0);
    assertEquals(calls.filter((c) => c.verb === 'update' || c.verb === 'upsert').length, 0);
  });
});

Deno.test('runAiPass: with no API key nothing is read and nothing is asked', async () => {
  const had = Deno.env.get('ANTHROPIC_API_KEY');
  Deno.env.delete('ANTHROPIC_API_KEY');
  try {
    const { admin, calls } = fakeAdmin(readPlan([txRow()]));
    assertEquals(await runAiPass(admin, ITEM, () => Promise.reject(new Error('must not be called'))), 0);
    assertEquals(calls.length, 0);
  } finally {
    if (had !== undefined) Deno.env.set('ANTHROPIC_API_KEY', had);
  }
});

Deno.test('loadCommunity never throws: a failed read means no crowd answers', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }) } as unknown as SupabaseClient;
  assertEquals((await loadCommunity(admin, ['k:shell'])).size, 0);
});

Deno.test('loadCommunity applies the threshold to what the database tallied', async () => {
  const admin = {
    rpc: () => Promise.resolve({
      data: [{ merchant: 'k:shell', direction: 'out', amount_band: 2, category_id: 'gas', votes: 3 }],
      error: null,
    }),
  } as unknown as SupabaseClient;
  assertEquals((await loadCommunity(admin, ['k:shell'])).get('k:shell|out|2'), 'gas');
});
