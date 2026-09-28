import { assertEquals, assertRejects } from 'jsr:@std/assert';

import {
  askJev,
  hasJevKey,
  JEV_CLIENT,
  JEV_MODEL,
  JEV_PASS_BUDGET_MS,
  JEV_URL,
  type JevQuestion,
  mapLimit,
  readChoice,
  readNoul,
  readScore,
  retryWaitMs,
} from './jev.ts';

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

const Q: Record<string, JevQuestion> = { urgent: { type: 'noul', instructions: 'Is this urgent?' } };
const OK = {
  model: 'jev-1.13.0',
  answers: { urgent: { type: 'noul', noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 3 },
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that replays `replies` in order and records what it was sent. */
function fakeFetch(replies: Reply[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const r = replies.shift();
    if (!r) throw new Error('no reply planned');
    return Promise.resolve(
      new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers }),
    );
  };
  return { fetchFn: fn as typeof fetch, sent };
}

const noSleep = () => Promise.resolve();

Deno.test('readChoice reads a choice and refuses anything else', () => {
  assertEquals(
    readChoice({ type: 'choice', choice: 'gas', confidence: 0.93, probabilities: { gas: 0.95 } }),
    { choice: 'gas', confidence: 0.93 },
  );
  assertEquals(readChoice({ type: 'score', score: 1, confidence: 1 }), null);
  assertEquals(readChoice({ type: 'choice', choice: 'gas' }), null);
  assertEquals(readChoice(undefined), null);
});

Deno.test('readScore reads the position on the levels and its confidence', () => {
  assertEquals(readScore({ type: 'score', score: 1.43, confidence: 0.64, probabilities: {} }), {
    score: 1.43,
    confidence: 0.64,
  });
  assertEquals(readScore({ type: 'score', score: 'high', confidence: 1 }), null);
  assertEquals(readScore({ type: 'noul', noul: 0.4 }), null);
});

Deno.test('readNoul reads a probability and refuses one outside 0..1', () => {
  assertEquals(readNoul({ type: 'noul', noul: 0.93 }), 0.93);
  assertEquals(readNoul({ type: 'noul', noul: 1.2 }), null);
  assertEquals(readNoul({ type: 'noul', noul: '0.9' }), null);
  assertEquals(readNoul(null), null);
});

Deno.test('hasJevKey follows JEV_API_KEY', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    // A project with no key syncs normally; every Jev pass is skipped.
    assertEquals(hasJevKey(), false);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
  await withKey(() => {
    assertEquals(hasJevKey(), true);
    return Promise.resolve();
  });
});

Deno.test('the client is bounded: a slow vendor must not hold a sync open', () => {
  assertEquals(JEV_CLIENT.timeout <= 10_000, true);
  assertEquals(JEV_CLIENT.maxRetries <= 1, true);
  assertEquals(JEV_PASS_BUDGET_MS <= 20_000, true);
});

Deno.test('askJev posts state, the pinned model and the questions, with the key as a bearer token', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 200, body: OK }]);
    const res = await askJev({ merchant: 'Shell' }, Q, { fetchFn, sleep: noSleep });
    assertEquals(res.answers.urgent, { type: 'noul', noul: 0.9 });
    assertEquals(res.model, 'jev-1.13.0');
    assertEquals(sent.length, 1);
    assertEquals(sent[0].url, JEV_URL);
    assertEquals(sent[0].init.method, 'POST');
    assertEquals((sent[0].init.headers as Record<string, string>).Authorization, 'Bearer jev-test');
    assertEquals(JSON.parse(sent[0].init.body as string), {
      state: { merchant: 'Shell' },
      model: JEV_MODEL,
      questions: Q,
    });
  });
});

Deno.test('askJev retries a 429 once, waiting out a short Retry-After', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 200, body: OK },
    ]);
    const waits: number[] = [];
    const res = await askJev({}, Q, { fetchFn, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
    assertEquals(res.answers.urgent, { type: 'noul', noul: 0.9 });
    assertEquals(sent.length, 2);
    assertEquals(waits, [1000]);
  });
});

Deno.test('askJev gives up after one retry', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 503 }, { status: 503 }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'HTTP 503');
    assertEquals(sent.length, 2);
  });
});

Deno.test('askJev does not retry a request the API refused', async () => {
  await withKey(async () => {
    for (const status of [400, 401, 402]) {
      const { fetchFn, sent } = fakeFetch([{ status }]);
      await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, `HTTP ${status}`);
      assertEquals(sent.length, 1);
    }
  });
});

Deno.test('askJev will not wait out a long Retry-After inside a sync', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 429, headers: { 'retry-after': '30' } }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'HTTP 429');
    assertEquals(sent.length, 1);
  });
});

Deno.test('askJev refuses a reply with no answers', async () => {
  await withKey(async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { model: 'jev-1.13.0' } }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'no answers');
  });
});

Deno.test('askJev without a key throws before sending anything', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    const { fetchFn, sent } = fakeFetch([]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'JEV_API_KEY');
    assertEquals(sent.length, 0);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
});

Deno.test('askJev past its deadline throws before sending anything', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 200, body: OK }]);
    await assertRejects(
      () => askJev({}, Q, { fetchFn, sleep: noSleep, deadline: Date.now() - 1 }),
      Error,
      'budget',
    );
    assertEquals(sent.length, 0);
  });
});

Deno.test('retryWaitMs: short waits are honoured, long ones are a failure', () => {
  assertEquals(retryWaitMs(null), 250);
  assertEquals(retryWaitMs(''), 250);
  assertEquals(retryWaitMs('garbage'), 250);
  assertEquals(retryWaitMs('0'), 0);
  assertEquals(retryWaitMs('1'), 1000);
  assertEquals(retryWaitMs('30'), null);
  const now = Date.parse('2026-09-27T12:00:00Z');
  assertEquals(retryWaitMs('Sun, 27 Sep 2026 12:00:01 GMT', now), 1000);
});

Deno.test('mapLimit never runs more than `limit` at once, and keeps order', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running--;
    return n * 2;
  });
  assertEquals(peak <= 3, true);
  assertEquals(out.map((s) => (s.status === 'fulfilled' ? s.value : null)), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
});

Deno.test('mapLimit settles a failure without stopping the rest', async () => {
  const out = await mapLimit([1, 2, 3], 2, (n) => (n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n)));
  assertEquals(out.map((s) => s.status), ['fulfilled', 'rejected', 'fulfilled']);
});

Deno.test('mapLimit starts nothing once the deadline has passed', async () => {
  let ran = 0;
  const out = await mapLimit([1, 2], 2, () => {
    ran++;
    return Promise.resolve(1);
  }, Date.now() - 1);
  assertEquals(ran, 0);
  assertEquals(out.every((s) => s.status === 'rejected'), true);
});
