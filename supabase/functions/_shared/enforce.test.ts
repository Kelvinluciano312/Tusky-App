import { assertEquals } from 'jsr:@std/assert';

import { CHOOSE_DAYS, decide, type EnforceItem, sameSecret } from './enforce.ts';
import type { PlanState } from './plans.ts';

const NOW = new Date('2026-10-10T09:00:00Z');
const plan = (over: Partial<PlanState> = {}): PlanState => ({
  plan: 'tusklet', source: 'own', expires_at: null, max_banks: 3, history_days: 365, ai: true, scope: 'self', banks_used: 3,
  ...over,
});
const item = (id: string, created_at: string): EnforceItem => ({ id, created_at, status: 'active' });
const FOUR = [
  item('a', '2026-01-01T00:00:00Z'),
  item('b', '2026-02-01T00:00:00Z'),
  item('c', '2026-03-01T00:00:00Z'),
  item('d', '2026-04-01T00:00:00Z'),
];

Deno.test('decide: within the limit, nothing happens and the window closes', () => {
  assertEquals(
    decide({ plan: plan(), items: FOUR.slice(0, 3), overLimitSince: '2026-10-01T00:00:00Z', now: NOW }),
    { archive: [], overLimitSince: null },
  );
});

Deno.test('decide: Free archives every bank at once', () => {
  assertEquals(
    decide({ plan: plan({ plan: 'free', max_banks: 0, banks_used: 2 }), items: FOUR.slice(0, 2), overLimitSince: null, now: NOW }),
    { archive: ['a', 'b'], overLimitSince: null },
  );
});

Deno.test('decide: a trial that lapsed a minute ago is Free, and every bank goes at once, window or not', () => {
  const lapsed = plan({
    plan: 'free', source: 'free', expires_at: null, max_banks: 0, history_days: 0, ai: false, banks_used: 1,
  });
  assertEquals(decide({ plan: lapsed, items: FOUR.slice(0, 1), overLimitSince: null, now: NOW }), {
    archive: ['a'],
    overLimitSince: null,
  });
  assertEquals(
    decide({ plan: lapsed, items: FOUR.slice(0, 2), overLimitSince: NOW.toISOString(), now: NOW }),
    { archive: ['a', 'b'], overLimitSince: null },
  );
});

Deno.test('decide: newly over a smaller plan opens the window and archives nothing', () => {
  assertEquals(
    decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: null, now: NOW }),
    { archive: [], overLimitSince: NOW.toISOString() },
  );
});

Deno.test('decide: inside the window nothing is archived yet', () => {
  const since = new Date(NOW.getTime() - (CHOOSE_DAYS - 1) * 86_400_000).toISOString();
  assertEquals(decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: since, now: NOW }), {
    archive: [],
    overLimitSince: since,
  });
});

Deno.test('decide: after the window, only the newest banks past the limit go', () => {
  const since = new Date(NOW.getTime() - CHOOSE_DAYS * 86_400_000).toISOString();
  assertEquals(decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: since, now: NOW }), {
    archive: ['d'],
    overLimitSince: since,
  });
});

Deno.test('decide: a herd pool is judged as one, across members', () => {
  const since = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
  const pool = [...FOUR, item('e', '2026-05-01T00:00:00Z')];
  assertEquals(
    decide({ plan: plan({ plan: 'tusk_herd', scope: 'herd', max_banks: 3, banks_used: 5 }), items: pool, overLimitSince: since, now: NOW }).archive,
    ['d', 'e'],
  );
});

Deno.test('sameSecret: equal strings only, and never with no secret configured', () => {
  assertEquals(sameSecret('abc123', 'abc123'), true);
  assertEquals(sameSecret('abc124', 'abc123'), false);
  assertEquals(sameSecret('abc', 'abc123'), false);
  assertEquals(sameSecret(null, 'abc123'), false);
  assertEquals(sameSecret('', ''), false);
  assertEquals(sameSecret('anything', undefined), false);
});
