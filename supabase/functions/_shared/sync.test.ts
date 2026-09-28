import { assertEquals } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import type { AiCategory, AiRow } from './ai.ts';
import type { JevAsk, JevResponse } from './jev.ts';
import { jevEnabled, loadCommunity, runAiPass, runTriagePass } from './sync.ts';

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
    for (const filter of ['eq', 'in', 'is', 'not', 'or', 'neq', 'gt', 'lt', 'gte', 'order', 'limit', 'range']) {
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

// The built-ins the pass loads: a group and one of its children.
const CATEGORY_ROWS = [
  { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_id: null },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_id: 'g-transport' },
];

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

/** The reads runAiPass makes, in order. The gate (jevEnabled) was checked before it. */
function readPlan(rows: unknown[], cache: unknown[] = []): Record<string, Resp[]> {
  return {
    'transactions:select': [{ data: rows }],
    'ai_category_cache:select': [{ data: cache }],
    'categories:select': [{ data: CATEGORY_ROWS }],
  };
}

const withKey = async (body: () => Promise<void>) => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.set('JEV_API_KEY', 'jev-test');
  try {
    await body();
  } finally {
    if (had === undefined) Deno.env.delete('JEV_API_KEY');
    else Deno.env.set('JEV_API_KEY', had);
  }
};

const gasAnswer = (r: AiRow) => ({ key: `${r.merchant_key}|out|2`, slug: 'gas', confidence: 0.97, level: 'child' as const });
const answerGas = (rows: AiRow[], _cats: AiCategory[]) => Promise.resolve(rows.map(gasAnswer));

Deno.test('jevEnabled: without a key nothing is read', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    const { admin, calls } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    assertEquals(calls.length, 0);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
});

Deno.test('jevEnabled: a user who has not opted in gets no Jev decisions', async () => {
  await withKey(async () => {
    const { admin, of } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: false } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    // The connector's own switch.
    assertEquals(of('profiles', 'select')[0].filters, [['eq', 'user_id', 'user-1']]);
  });
});

Deno.test('jevEnabled: key, seam and switch together turn it on', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), true);
  });
});

Deno.test('jevEnabled: a failed profile read means off, never a thrown sync', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'profiles:select': [{ data: null, error: { message: 'boom' } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
  });
});

Deno.test('runAiPass: Jev is offered the built-in groups and their children', async () => {
  const { admin, of } = fakeAdmin(readPlan([txRow()]));
  let offered: AiCategory[] = [];
  await runAiPass(admin, ITEM, (rows, cats) => {
    offered = cats;
    return answerGas(rows, cats);
  });
  assertEquals(offered, [
    { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_slug: null },
    { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_slug: 'transportation' },
  ]);
  // Built-ins only: a herd's custom category must never reach the global cache.
  assertEquals(of('categories', 'select')[0].filters, [['is', 'herd_id', null]]);
});

Deno.test('runAiPass: answers are written grouped, stamped `ai` with their confidence, and only over rows still not manual', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', amount: -49 })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, answerGas);

  assertEquals(set, 2);
  const writes = of('transactions', 'update');
  assertEquals(writes.length, 1);
  assertEquals(writes[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: 0.97,
    ai_level: 'child',
  });
  assertEquals(writes[0].filters, [
    ['in', 'id', ['t1', 't2']],
    // A row someone categorized by hand between the read and the write stays put.
    ['eq', 'category_is_manual', false],
  ]);
});

Deno.test('runAiPass: a group-level answer lands on the group', async () => {
  const { admin, of } = fakeAdmin(readPlan([txRow()]));
  await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.map((r) => ({
      key: `${r.merchant_key}|out|2`,
      slug: 'transportation',
      confidence: 0.93,
      level: 'group' as const,
    }))));
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'g-transport',
    category_source: 'ai',
    ai_confidence: 0.93,
    ai_level: 'group',
  });
});

Deno.test("runAiPass: a private account's merchant never reaches the global cache", async () => {
  const rows = [txRow({ id: 'p1', accounts: { is_private: true } })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, answerGas);

  assertEquals(set, 1);
  assertEquals(of('transactions', 'update').length, 1);
  assertEquals(of('ai_category_cache', 'upsert').length, 0);
});

Deno.test('runAiPass: a shared answer is cached with its confidence, and a declined merchant is cached as null', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', merchant_key: 'mystery', name: 'POS DEBIT 88213' })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.map((r) =>
      r.merchant_key === 'shell'
        ? gasAnswer(r)
        // Jev chose "none of these fits": an explicit decline.
        : { key: `${r.merchant_key}|out|2`, slug: null }
    )));

  assertEquals(set, 1);
  const cached = of('ai_category_cache', 'upsert');
  assertEquals(cached.length, 1);
  assertEquals(cached[0].payload, [
    { cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.97, level: 'child' },
    // Without this row, the same unplaceable merchant is sent again every sync.
    { cache_key: 'mystery|out|2', category_id: null, confidence: null, level: null },
  ]);
});

Deno.test('runAiPass: a merchant whose call failed is neither written nor remembered', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', merchant_key: 'mystery', name: 'POS DEBIT 88213' })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  // Only shell came back: mystery's call failed (a 503, a timeout, the budget).
  const set = await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.filter((r) => r.merchant_key === 'shell').map(gasAnswer)));

  assertEquals(set, 1);
  // Remembering mystery as declined would stop us ever asking about it again.
  assertEquals(of('ai_category_cache', 'upsert')[0].payload, [
    { cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.97, level: 'child' },
  ]);
});

Deno.test('runAiPass: a cache hit carries its confidence onto the row and asks nothing', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow()], [{ cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.96, level: 'child' }]),
  );
  let asked = false;
  const set = await runAiPass(admin, ITEM, () => {
    asked = true;
    return Promise.resolve([]);
  });
  assertEquals(asked, false);
  assertEquals(set, 1);
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: 0.96,
    ai_level: 'child',
  });
});

Deno.test('runAiPass: a 12b-era cache hit has no confidence, and says so', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow()], [{ cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: null, level: null }]),
  );
  await runAiPass(admin, ITEM, () => Promise.resolve([]));
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: null,
    ai_level: null,
  });
});

Deno.test('runAiPass: a cached null answer costs nothing and asks nothing', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow({ id: 't1' })], [{ cache_key: 'shell|out|2', category_id: null, confidence: null, level: null }]),
  );
  let asked = false;
  const set = await runAiPass(admin, ITEM, () => {
    asked = true;
    return Promise.resolve([]);
  });
  assertEquals(asked, false);
  assertEquals(set, 0);
  assertEquals(of('transactions', 'update').length, 0);
  assertEquals(of('ai_category_cache', 'upsert').length, 0);
});

Deno.test('runAiPass: a vendor that fails costs the sync nothing', async () => {
  const { admin, calls } = fakeAdmin(readPlan([txRow()]));
  const set = await runAiPass(admin, ITEM, () => Promise.reject(new Error('jev: HTTP 402')));
  assertEquals(set, 0);
  assertEquals(calls.filter((c) => c.verb === 'update' || c.verb === 'upsert').length, 0);
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

// --- Triage (12d) ------------------------------------------------------------

const triRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'r1',
  name: 'TRADER JOES 552',
  merchant_name: "Trader Joe's",
  amount: -84.1,
  category_id: 'c-groceries',
  category_source: 'plaid',
  split: null,
  accounts: { is_private: false },
  ...over,
});

/** The reads runTriagePass makes, in order. */
function triagePlan(rows: unknown[], members: string[] = ['user-1']): Record<string, Resp[]> {
  return {
    'transactions:select': [{ data: rows }],
    'herd_members:select': [{ data: members.map((user_id) => ({ user_id })) }],
    'categories:select': [{ data: [{ id: 'c-groceries', name: 'Groceries' }] }],
  };
}

const judged = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });
const fixAndShare: JevAsk = () =>
  Promise.resolve(judged({
    review_priority: { type: 'score', score: 1.8, confidence: 0.7, probabilities: {} },
    is_shared_expense: { type: 'noul', noul: 0.9 },
  }));

Deno.test('runTriagePass: reads only unreviewed, unjudged posted rows, newest first, 50 at a time', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow()]));
  await runTriagePass(admin, ITEM, fixAndShare);
  assertEquals(of('transactions', 'select')[0].filters, [
    ['eq', 'item_id', 'item-1'],
    ['eq', 'pending', false],
    ['is', 'reviewed_at', null],
    ['is', 'review_priority', null],
    ['order', 'date', { ascending: false }],
    ['limit', 50],
  ]);
});

Deno.test('runTriagePass: writes grouped, and never over a row reviewed meanwhile', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow({ id: 'r1' }), triRow({ id: 'r2' })], ['user-1', 'user-2']));
  const written = await runTriagePass(admin, ITEM, fixAndShare);

  assertEquals(written, 2);
  const writes = of('transactions', 'update');
  assertEquals(writes.length, 1);
  assertEquals(writes[0].payload, { review_priority: 2, split_suggested: true });
  assertEquals(writes[0].filters, [['in', 'id', ['r1', 'r2']], ['is', 'reviewed_at', null]]);
});

Deno.test('runTriagePass: in a herd of one, only the priority is asked', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow()]));
  const asked: string[][] = [];
  await runTriagePass(admin, ITEM, (_state, questions) => {
    asked.push(Object.keys(questions));
    return fixAndShare({}, {});
  });
  assertEquals(asked, [['review_priority']]);
  assertEquals(of('transactions', 'update')[0].payload, { review_priority: 2, split_suggested: null });
});

Deno.test('runTriagePass: a row whose call failed stays unjudged for the next sync', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow({ id: 'r1' }), triRow({ id: 'r2', name: 'OTHER' })]));
  const written = await runTriagePass(admin, ITEM, (state, questions) =>
    (state as { description: string }).description === 'OTHER'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : fixAndShare(state, questions));
  assertEquals(written, 1);
  assertEquals(of('transactions', 'update')[0].filters[0], ['in', 'id', ['r1']]);
});

Deno.test('runTriagePass: a vendor that fails costs the sync nothing', async () => {
  const { admin, calls } = fakeAdmin(triagePlan([triRow()]));
  assertEquals(await runTriagePass(admin, ITEM, () => Promise.reject(new Error('jev: HTTP 402'))), 0);
  assertEquals(calls.filter((c) => c.verb === 'update').length, 0);
});

Deno.test('runTriagePass: nothing to judge reads no herd and asks nothing', async () => {
  const { admin, of } = fakeAdmin(triagePlan([]));
  let asked = false;
  const written = await runTriagePass(admin, ITEM, () => {
    asked = true;
    return fixAndShare({}, {});
  });
  assertEquals(written, 0);
  assertEquals(asked, false);
  assertEquals(of('herd_members', 'select').length, 0);
});
