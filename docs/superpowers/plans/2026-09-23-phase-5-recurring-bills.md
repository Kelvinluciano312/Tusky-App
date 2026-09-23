# Phase 5 — Recurring Transactions and Bills Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect recurring bills, subscriptions and paychecks from synced transactions, and show what is due soon on Home and in a Recurring screen.

**Architecture:** A pure TypeScript detector (`supabase/functions/_shared/recurring.ts`) runs at the end of every successful `syncItem`, over that Item's posted transactions, and upserts into a new `recurring_streams` table. The table's one user-owned column, `dismissed`, is never written by detection. The app reads the table directly (RLS), computes "upcoming" with local-date math, and renders a Home card plus a pushed `/recurring` screen.

**Tech Stack:** Supabase Postgres + RLS, Deno Edge Functions (`npm:@supabase/supabase-js@2`, `jsr:@std/assert` for tests), Expo SDK 57 / expo-router (typed routes), React Query.

**Spec:** `docs/superpowers/specs/2026-09-23-phase-5-recurring-bills-design.md`

## Global Constraints

- Every monetary amount renders via `src/components/ui/amount.tsx`; text via `AppText`; colors/spacing only from `src/constants/theme.ts`.
- New tables: RLS on, `(select auth.uid()) = user_id` policies, explicit `grant` to `authenticated`.
- Detection must never write `dismissed` — omit it from the upsert payload; always emit every other key, `amount_change: null` included (ragged keys are PGRST102).
- `max_rows = 1000` truncates silently — any read that can exceed it pages with `.range()`.
- Detection failures are logged and swallowed; they must never turn a good sync into `status: 'error'` or escape `syncItem`.
- Amounts keep the ledger sign of `transactions.amount`: negative = money out.
- Cadence constants: weekly 5–9 days ±20%; biweekly 11–17 days ±20%; monthly 25–35 days ±35%; ≥ 3 occurrences; monthly next date = anchor day in the first month on/after `last + 20 days`, clamped to month end; price flag when all earlier amounts equal to the cent and the move ≥ max($1, 5%).
- Client "today" is the **local** date (`T00:00:00` idiom from `lib/month.ts`), never `toISOString()`.
- Run `npm run typecheck && npx expo lint` (in `apps/mobile`) before each client commit; `npx -y deno test supabase/functions/_shared/` before each backend commit.
- PowerShell 5.1 note: no `&&`; avoid double quotes inside commit messages. The Bash tool is fine.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A merchant string that normalizes to nothing (`"#1234 *"`) must be skipped, not grouped under `""` — test in Task 1.
- An Item with more than 1000 posted transactions in 180 days must still be detected in full — the paging loop in Task 3; verify by reading the loop's exit condition in review.
- Hiding an account (retroactive filter) must drop its streams from Home and the screen — the `accounts!inner(hidden)` embed in Task 4; checked live in Task 7.
- A dismissed stream must stay dismissed across syncs and survive re-detection — `dismissed` absent from the payload and `staleStreamIds` skipping dismissed rows (Task 1 test + Task 7 live check).
- An app left open across midnight must move its dates — Home recomputes its window per render (Task 6) and the card's `today` is derived per render; checked live in Task 7.

---

### Task 1: Pure detector (`detectStreams`, `staleStreamIds`)

**Files:**
- Create: `supabase/functions/_shared/recurring.ts`
- Test: `supabase/functions/_shared/recurring.test.ts`

**Interfaces:**
- Produces: `type Cadence = 'weekly' | 'biweekly' | 'monthly'`; `type Direction = 'outflow' | 'inflow'`; `type DetectInput = { account_id: string; date: string; amount: number; name: string; merchant_name: string | null; category_id: string | null }`; `type StreamRow` (fields below); `detectStreams(rows: DetectInput[], opts: { transferCategoryIds: string[] }): StreamRow[]`; `normalizeMerchant(raw: string): string`; `type ExistingStream = { id: string; account_id: string; direction: Direction; merchant_key: string; dismissed: boolean }`; `staleStreamIds(existing: ExistingStream[], fresh: Pick<StreamRow, 'account_id' | 'direction' | 'merchant_key'>[]): string[]`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/_shared/recurring.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';

import { type DetectInput, detectStreams, normalizeMerchant, staleStreamIds } from './recurring.ts';

const TRANSFER = 'cat-transfer';

function tx(date: string, amount: number, name = 'Netflix', extra: Partial<DetectInput> = {}): DetectInput {
  return { account_id: 'acct-1', date, amount, name, merchant_name: null, category_id: 'cat-ent', ...extra };
}

const detect = (rows: DetectInput[]) => detectStreams(rows, { transferCategoryIds: [TRANSFER] });

Deno.test('a fixed monthly charge becomes one monthly stream', () => {
  const streams = detect([tx('2026-06-15', -15.49), tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]);
  assertEquals(streams.length, 1);
  const s = streams[0];
  assertEquals(s.merchant_key, 'netflix');
  assertEquals(s.direction, 'outflow');
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
  assertEquals(s.last_amount, -15.49);
  assertEquals(s.previous_amount, -15.49);
  assertEquals(s.amount_change, null);
  assertEquals(s.first_date, '2026-06-15');
  assertEquals(s.last_date, '2026-08-15');
  assertEquals(s.next_date, '2026-09-15');
});

Deno.test('weekend jitter still reads as monthly and predicts the anchor day', () => {
  const [s] = detect([tx('2026-06-15', -50), tx('2026-07-17', -50), tx('2026-08-14', -50)]);
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.next_date, '2026-09-15');
});

Deno.test('a month-end anchor clamps to a short month', () => {
  const [s] = detect([tx('2026-11-30', -20), tx('2026-12-31', -20), tx('2027-01-31', -20)]);
  assertEquals(s.next_date, '2027-02-28');
});

Deno.test('a bill paid early across a month boundary predicts the following month', () => {
  const [s] = detect([tx('2026-07-01', -1850, 'Rent'), tx('2026-08-01', -1850, 'Rent'), tx('2026-08-30', -1850, 'Rent')]);
  assertEquals(s.next_date, '2026-10-01');
});

Deno.test('two occurrences are not enough', () => {
  assertEquals(detect([tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]), []);
});

Deno.test('weekly groceries with swinging amounts are rejected', () => {
  const rows = [
    tx('2026-07-01', -32.1, 'Whole Foods'),
    tx('2026-07-08', -88.4, 'Whole Foods'),
    tx('2026-07-15', -51, 'Whole Foods'),
    tx('2026-07-22', -120.75, 'Whole Foods'),
    tx('2026-07-29', -45, 'Whole Foods'),
  ];
  assertEquals(detect(rows), []);
});

Deno.test('a fixed weekly charge becomes a weekly stream', () => {
  const [s] = detect(['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22'].map((d) => tx(d, -9.99, 'Gym')));
  assertEquals(s.frequency, 'weekly');
  assertEquals(s.occurrences, 4);
  assertEquals(s.next_date, '2026-07-29');
});

Deno.test('a biweekly paycheck is an inflow stream', () => {
  const rows = ['2026-07-03', '2026-07-17', '2026-07-31'].map((d) =>
    tx(d, 2400, 'ACME PAYROLL', { category_id: 'cat-income' })
  );
  const [s] = detect(rows);
  assertEquals(s.direction, 'inflow');
  assertEquals(s.frequency, 'biweekly');
  assertEquals(s.merchant_key, 'acme payroll');
  assertEquals(s.next_date, '2026-08-14');
});

Deno.test('only the latest regular run counts', () => {
  const rows = ['2026-03-02', '2026-04-20', '2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -15.49));
  const [s] = detect(rows);
  assertEquals(s.first_date, '2026-06-15');
  assertEquals(s.occurrences, 3);
});

Deno.test('a prorated first charge is trimmed from the run', () => {
  const [s] = detect([tx('2026-06-01', -5.16), tx('2026-07-01', -15.49), tx('2026-08-01', -15.49), tx('2026-09-01', -15.49)]);
  assertEquals(s.first_date, '2026-07-01');
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
});

Deno.test('a fixed price that moves is flagged', () => {
  const [s] = detect([tx('2026-06-15', -15.49), tx('2026-07-15', -15.49), tx('2026-08-15', -17.99)]);
  assertEquals(s.amount_change, 2.5);
  assertEquals(s.last_amount, -17.99);
  assertEquals(s.previous_amount, -15.49);
});

Deno.test('a variable utility is detected but never flagged', () => {
  const [s] = detect([tx('2026-06-20', -82.1, 'City Power'), tx('2026-07-20', -96.4, 'City Power'), tx('2026-08-20', -110, 'City Power')]);
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.amount_change, null);
});

Deno.test('transfer-kind categories are excluded', () => {
  const rows = ['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -500, 'To Savings', { category_id: TRANSFER }));
  assertEquals(detect(rows), []);
});

Deno.test('merchant strings normalize so store numbers do not split a stream', () => {
  const [s, ...rest] = detect([
    tx('2026-06-15', -15.49, 'NETFLIX.COM 1234'),
    tx('2026-07-15', -15.49, 'Netflix.com 5678'),
    tx('2026-08-15', -15.49, 'NETFLIX.COM 9012'),
  ]);
  assertEquals(rest, []);
  assertEquals(s.merchant_key, 'netflix com');
});

Deno.test('merchant_name wins over the raw name, and names the stream', () => {
  const [s] = detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) =>
    tx(d, -6.5, 'SQ *BLUE BOTTLE 88', { merchant_name: 'Blue Bottle' })
  ));
  assertEquals(s.merchant_key, 'blue bottle');
  assertEquals(s.name, 'Blue Bottle');
});

Deno.test('a merchant that normalizes to nothing is skipped', () => {
  assertEquals(normalizeMerchant('#1234 *'), '');
  assertEquals(detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -10, '#1234 *'))), []);
});

Deno.test('same-day charges merge into one occurrence', () => {
  const [s] = detect([tx('2026-06-15', -10), tx('2026-06-15', -5.49), tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]);
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
});

Deno.test('zero amounts are ignored', () => {
  assertEquals(detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, 0))), []);
});

Deno.test('the same merchant on two accounts is two streams, sorted deterministically', () => {
  const dates = ['2026-06-15', '2026-07-15', '2026-08-15'];
  const streams = detect([
    ...dates.map((d) => tx(d, -15.49, 'Netflix', { account_id: 'acct-2' })),
    ...dates.map((d) => tx(d, -15.49, 'Netflix', { account_id: 'acct-1' })),
  ]);
  assertEquals(streams.map((s) => s.account_id), ['acct-1', 'acct-2']);
});

Deno.test('staleStreamIds drops vanished streams but never dismissed ones', () => {
  const existing = [
    { id: 'keep', account_id: 'a', direction: 'outflow' as const, merchant_key: 'netflix', dismissed: false },
    { id: 'gone', account_id: 'a', direction: 'outflow' as const, merchant_key: 'hulu', dismissed: false },
    { id: 'dismissed', account_id: 'a', direction: 'outflow' as const, merchant_key: 'gym', dismissed: true },
  ];
  const fresh = [{ account_id: 'a', direction: 'outflow' as const, merchant_key: 'netflix' }];
  assertEquals(staleStreamIds(existing, fresh), ['gone']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx -y deno test supabase/functions/_shared/recurring.test.ts`
Expected: FAIL — `Module not found "file:///.../recurring.ts"`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/_shared/recurring.ts`:

```ts
/**
 * Recurring detection: which merchants come back on a schedule.
 *
 * Pure on purpose — posted transactions in, stream rows out — so every rule
 * below is pinned by recurring.test.ts. refreshRecurring (Task 3) does the I/O.
 * Our own heuristics rather than Plaid's /transactions/recurring/get, which is
 * a separate per-Item monthly fee and wants 180+ days of history; see the
 * Phase 5 spec.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly';
export type Direction = 'outflow' | 'inflow';

/** One posted transaction, as refreshRecurring selects it. */
export type DetectInput = {
  account_id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** Ledger sign, as in transactions.amount: negative = money out. */
  amount: number;
  name: string;
  merchant_name: string | null;
  category_id: string | null;
};

export type StreamRow = {
  account_id: string;
  merchant_key: string;
  direction: Direction;
  name: string;
  category_id: string | null;
  frequency: Cadence;
  average_amount: number;
  last_amount: number;
  previous_amount: number;
  /** |last| − |previous|, set only when a fixed price moved. */
  amount_change: number | null;
  first_date: string;
  last_date: string;
  next_date: string;
  occurrences: number;
};

export type ExistingStream = {
  id: string;
  account_id: string;
  direction: Direction;
  merchant_key: string;
  dismissed: boolean;
};

export const MIN_OCCURRENCES = 3;

/** Interval window per cadence, and how far an amount may sit from the run's median. */
export const CADENCES: Record<Cadence, { minDays: number; maxDays: number; tolerance: number }> = {
  weekly: { minDays: 5, maxDays: 9, tolerance: 0.2 },
  biweekly: { minDays: 11, maxDays: 17, tolerance: 0.2 },
  monthly: { minDays: 25, maxDays: 35, tolerance: 0.35 },
};

/**
 * A monthly prediction lands no sooner than this after the last charge. It is
 * what makes a Sep-1 bill paid early on Aug 30 predict Oct 1 rather than Sep 1.
 */
const MONTHLY_MIN_GAP_DAYS = 20;
const PRICE_CHANGE_MIN = 1;
const PRICE_CHANGE_PCT = 0.05;

const DAY_MS = 86_400_000;

/** Days since the epoch, in UTC. Calendar dates only — no timezone enters. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Lowercase letters only: store numbers, dates and punctuation drop out. */
export function normalizeMerchant(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function cadenceFor(gapDays: number): Cadence | null {
  for (const cadence of Object.keys(CADENCES) as Cadence[]) {
    const { minDays, maxDays } = CADENCES[cadence];
    if (gapDays >= minDays && gapDays <= maxDays) return cadence;
  }
  return null;
}

function withinTolerance(amount: number, center: number, tolerance: number): boolean {
  return Math.abs(Math.abs(amount) - Math.abs(center)) <= tolerance * Math.abs(center);
}

/** The anchor day in the first month on or after last + MONTHLY_MIN_GAP_DAYS, clamped to month end. */
function nextMonthlyDate(lastDate: string, anchorDay: number): string {
  const earliest = dayNumber(lastDate) + MONTHLY_MIN_GAP_DAYS;
  const start = new Date(earliest * DAY_MS);
  let year = start.getUTCFullYear();
  let month0 = start.getUTCMonth();
  for (;;) {
    const candidate = Date.UTC(year, month0, Math.min(anchorDay, daysInMonth(year, month0))) / DAY_MS;
    if (candidate >= earliest) return isoFromDay(candidate);
    month0 += 1;
    if (month0 === 12) {
      month0 = 0;
      year += 1;
    }
  }
}

type Occurrence = { date: string; day: number; amount: number; source: DetectInput };
type Detected = Omit<StreamRow, 'account_id' | 'merchant_key' | 'direction'>;

/** One merchant's occurrences, oldest first → a stream, or null. */
function detectGroup(occ: Occurrence[]): Detected | null {
  const n = occ.length;
  if (n < MIN_OCCURRENCES) return null;

  // The newest interval picks the cadence; walk back while intervals fit it.
  const cadence = cadenceFor(occ[n - 1].day - occ[n - 2].day);
  if (!cadence) return null;
  const { minDays, maxDays, tolerance } = CADENCES[cadence];
  let start = n - 1;
  while (start > 0) {
    const gap = occ[start].day - occ[start - 1].day;
    if (gap < minDays || gap > maxDays) break;
    start--;
  }
  const run = occ.slice(start);

  // Drop leading amount outliers — a prorated first charge.
  while (
    run.length > MIN_OCCURRENCES &&
    !withinTolerance(run[0].amount, median(run.slice(1).map((o) => o.amount)), tolerance)
  ) {
    run.shift();
  }
  if (run.length < MIN_OCCURRENCES) return null;

  const amounts = run.map((o) => o.amount);
  const center = median(amounts);
  if (!amounts.every((a) => withinTolerance(a, center, tolerance))) return null;

  const last = run[run.length - 1];
  const previous = run[run.length - 2];

  // Flag only a FIXED price that moved, so variable utilities never flag.
  const earlier = amounts.slice(0, -1);
  const fixed = earlier.every((a) => Math.round(a * 100) === Math.round(earlier[0] * 100));
  const delta = round2(Math.abs(last.amount) - Math.abs(previous.amount));
  const moved = Math.abs(delta) >= Math.max(PRICE_CHANGE_MIN, PRICE_CHANGE_PCT * Math.abs(previous.amount));

  const next_date = cadence === 'monthly'
    ? nextMonthlyDate(last.date, Math.round(median(run.map((o) => Number(o.date.slice(8, 10))))))
    : isoFromDay(last.day + (cadence === 'weekly' ? 7 : 14));

  return {
    name: last.source.merchant_name ?? last.source.name,
    category_id: last.source.category_id,
    frequency: cadence,
    average_amount: round2(amounts.reduce((sum, a) => sum + a, 0) / amounts.length),
    last_amount: round2(last.amount),
    previous_amount: round2(previous.amount),
    amount_change: fixed && moved ? delta : null,
    first_date: run[0].date,
    last_date: last.date,
    next_date,
    occurrences: run.length,
  };
}

const streamKey = (s: { account_id: string; direction: Direction; merchant_key: string }) =>
  `${s.account_id}|${s.direction}|${s.merchant_key}`;

/**
 * Posted transactions → recurring streams, one per (account, direction,
 * merchant). Transfer-kind categories are excluded by OUR category_id, so a
 * manual recategorization to Transfer takes a stream out at the next sync.
 */
export function detectStreams(rows: DetectInput[], opts: { transferCategoryIds: string[] }): StreamRow[] {
  const transfers = new Set(opts.transferCategoryIds);
  const groups = new Map<
    string,
    { account_id: string; merchant_key: string; direction: Direction; byDate: Map<string, Occurrence> }
  >();

  for (const r of rows) {
    if (r.amount === 0) continue;
    if (r.category_id && transfers.has(r.category_id)) continue;
    const merchant_key = normalizeMerchant(r.merchant_name ?? r.name);
    if (!merchant_key) continue;
    const direction: Direction = r.amount < 0 ? 'outflow' : 'inflow';
    const key = streamKey({ account_id: r.account_id, direction, merchant_key });

    let group = groups.get(key);
    if (!group) {
      group = { account_id: r.account_id, merchant_key, direction, byDate: new Map() };
      groups.set(key, group);
    }
    // Same-day charges at one merchant are one payment.
    const sameDay = group.byDate.get(r.date);
    if (sameDay) {
      sameDay.amount = round2(sameDay.amount + r.amount);
      sameDay.source = r;
    } else {
      group.byDate.set(r.date, { date: r.date, day: dayNumber(r.date), amount: r.amount, source: r });
    }
  }

  const out: StreamRow[] = [];
  for (const g of groups.values()) {
    const found = detectGroup([...g.byDate.values()].sort((a, b) => a.day - b.day));
    if (found) out.push({ account_id: g.account_id, merchant_key: g.merchant_key, direction: g.direction, ...found });
  }
  return out.sort((a, b) => (streamKey(a) < streamKey(b) ? -1 : streamKey(a) > streamKey(b) ? 1 : 0));
}

/**
 * Existing streams that detection no longer finds. Dismissed rows are never
 * returned: `dismissed` is the user's verdict, and keeping the row is what
 * lets it survive the stream re-qualifying later.
 */
export function staleStreamIds(
  existing: ExistingStream[],
  fresh: Pick<StreamRow, 'account_id' | 'direction' | 'merchant_key'>[],
): string[] {
  const keep = new Set(fresh.map(streamKey));
  return existing.filter((s) => !s.dismissed && !keep.has(streamKey(s))).map((s) => s.id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: PASS — the existing 32 plus 20 new, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/recurring.ts supabase/functions/_shared/recurring.test.ts
git commit -m "feat: recurring stream detector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `recurring_streams` table

**Files:**
- Create: `supabase/migrations/20260923180000_phase5_recurring_streams.sql`

**Interfaces:**
- Produces: table `public.recurring_streams` with the columns of `StreamRow` plus `id uuid`, `user_id uuid`, `dismissed boolean`, `created_at`, `updated_at`; unique `(account_id, direction, merchant_key)`; client grants `select` and `update (dismissed)`.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 5: recurring streams — bills, subscriptions and paychecks that come back.

-- One row per (account, direction, merchant), written by the service role at
-- the end of each sync (_shared/recurring.ts). Per-account, so the per-Item
-- sync claim means no two invocations ever write the same row.
create table public.recurring_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  merchant_key text not null,
  direction text not null check (direction in ('outflow', 'inflow')),
  name text not null,
  category_id uuid references public.categories (id),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- Ledger sign, as in transactions.amount: negative = money out.
  average_amount numeric(14, 2) not null,
  last_amount numeric(14, 2) not null,
  previous_amount numeric(14, 2) not null,
  -- |last| − |previous|; set only when a fixed price moved.
  amount_change numeric(14, 2),
  first_date date not null,
  last_date date not null,
  next_date date not null,
  occurrences int not null check (occurrences >= 3),
  -- The user's verdict. Detection NEVER writes it: the upsert payload omits
  -- the key, and PostgREST's DO UPDATE SET only covers keys present — the same
  -- rule that protects accounts.hidden.
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The upsert conflict target.
  unique (account_id, direction, merchant_key)
);

-- The read path: every client query filters user_id and orders by next_date.
create index recurring_streams_user_next_idx on public.recurring_streams (user_id, next_date);

create trigger recurring_streams_updated_at
  before update on public.recurring_streams
  for each row execute function public.set_updated_at();

alter table public.recurring_streams enable row level security;

create policy "Users can view their own recurring streams"
  on public.recurring_streams for select
  using ((select auth.uid()) = user_id);

create policy "Users can dismiss their own recurring streams"
  on public.recurring_streams for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.recurring_streams to authenticated;
-- Column-level: a client may dismiss or restore, never rewrite what was detected.
grant update (dismissed) on public.recurring_streams to authenticated;
```

- [ ] **Step 2: Apply it**

Run (repo root): `npx supabase db push`
Expected: `Applying migration 20260923180000_phase5_recurring_streams.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Verify the security boundary**

Run (Bash, repo root; loads the app's public URL and anon key):

```bash
set -a; . apps/mobile/.env; set +a
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/recurring_streams?select=id&limit=1" -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/recurring_streams?id=not.is.null" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"dismissed":true}'
```

Expected: `[]`, then `401` (anon holds no grant).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923180000_phase5_recurring_streams.sql
git commit -m "feat(db): recurring_streams table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Run detection at the end of every sync

**Files:**
- Modify: `supabase/functions/_shared/recurring.ts` (append `refreshRecurring`)
- Modify: `supabase/functions/_shared/sync.ts` (`SyncContext`, `loadSyncContext`, `syncItem` tail)

**Interfaces:**
- Consumes: `detectStreams`, `staleStreamIds`, `DetectInput` (Task 1); table from Task 2.
- Produces: `refreshRecurring(admin: SupabaseClient, item: { id: string; user_id: string }, transferCategoryIds: string[]): Promise<void>`; `SyncContext.transferCategoryIds: string[]`.

- [ ] **Step 1: Append the I/O wrapper to `recurring.ts`**

Add at the top of the file, below the doc comment:

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
```

Append at the end:

```ts
/** How far back detection looks. Enough for six monthly occurrences. */
const LOOKBACK_DAYS = 180;
/** PostgREST's max_rows. A longer page would be truncated SILENTLY. */
const PAGE_SIZE = 1000;

/**
 * Detect and store one Item's streams. Throws on any database error — the
 * caller (syncItem) swallows it so a failed radar never fails a sync.
 *
 * Runs under syncItem's per-Item claim, and streams are per account, so no
 * other invocation can be writing these rows.
 */
export async function refreshRecurring(
  admin: SupabaseClient,
  item: { id: string; user_id: string },
  transferCategoryIds: string[],
): Promise<void> {
  const since = isoFromDay(Math.floor(Date.now() / DAY_MS) - LOOKBACK_DAYS);

  const rows: DetectInput[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('transactions')
      .select('account_id, date, amount, name, merchant_name, category_id')
      .eq('item_id', item.id)
      .eq('pending', false)
      .gte('date', since)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE_SIZE) break;
  }

  const streams = detectStreams(rows, { transferCategoryIds });

  if (streams.length > 0) {
    // `dismissed` is deliberately absent: DO UPDATE SET covers only the keys
    // present, so the user's verdict survives. Every other key is always
    // present, amount_change: null included — ragged keys are PGRST102.
    const { error } = await admin
      .from('recurring_streams')
      .upsert(streams.map((s) => ({ ...s, user_id: item.user_id })), {
        onConflict: 'account_id,direction,merchant_key',
      });
    if (error) throw error;
  }

  const { data: accounts, error: accountsError } = await admin
    .from('accounts').select('id').eq('item_id', item.id);
  if (accountsError) throw accountsError;

  const { data: existing, error: existingError } = await admin
    .from('recurring_streams')
    .select('id, account_id, direction, merchant_key, dismissed')
    .in('account_id', (accounts ?? []).map((a) => a.id));
  if (existingError) throw existingError;

  const stale = staleStreamIds(existing ?? [], streams);
  if (stale.length > 0) {
    const { error } = await admin.from('recurring_streams').delete().in('id', stale);
    if (error) throw error;
  }
}
```

- [ ] **Step 2: Load transfer category ids in `loadSyncContext`**

In `supabase/functions/_shared/sync.ts`, change the import block and `SyncContext`:

```ts
import { buildSnapshotRows, syncAccounts } from './accounts.ts';
import { type CategoryMap, pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';
import { refreshRecurring } from './recurring.ts';
```

```ts
/** Everything a sync needs that is the same for every Item. */
export type SyncContext = {
  admin: SupabaseClient;
  plaid: PlaidApi;
  categoryMap: CategoryMap;
  fallbackId: string;
  /** Categories of kind 'transfer' — recurring detection ignores them. */
  transferCategoryIds: string[];
};
```

In `loadSyncContext`, replace the final `return { admin, plaid, categoryMap, fallbackId: fallback.id };` with:

```ts
  const { data: transferRows, error: transferError } = await admin
    .from('categories').select('id').eq('kind', 'transfer');
  if (transferError) throw new Error(`failed to load transfer categories: ${transferError.message}`);

  return {
    admin,
    plaid,
    categoryMap,
    fallbackId: fallback.id,
    transferCategoryIds: (transferRows ?? []).map((r) => r.id),
  };
```

- [ ] **Step 3: Call it last in `syncItem`**

In `syncItem`, destructure the new field — change `const { admin, plaid, categoryMap, fallbackId } = ctx;` to:

```ts
  const { admin, plaid, categoryMap, fallbackId, transferCategoryIds } = ctx;
```

Then, directly after the snapshot block's closing `}` (the `catch` that logs `balance snapshot failed`) and still inside the outer `try`, add:

```ts

    // After the snapshot, for the same reasons: success is already latched and
    // the cursor has advanced, so a failed radar costs nothing but a log line.
    // Never in `finally` — the login_required and error paths have no new data,
    // and a throw there would escape syncItem.
    try {
      await refreshRecurring(admin, item, transferCategoryIds);
    } catch (err) {
      console.warn(`recurring refresh failed for item ${item.id}: ${describeError(err)}`);
    }
```

- [ ] **Step 4: Check it compiles and nothing regressed**

Run: `npx -y deno check supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts`
Expected: no output, exit 0.

Run: `npx -y deno test supabase/functions/_shared/`
Expected: PASS, 52 tests.

- [ ] **Step 5: Deploy the two functions that import `sync.ts`**

Run: `npx supabase functions deploy plaid-sync-transactions plaid-webhook --use-api`
Expected: `Deployed Functions ... plaid-sync-transactions, plaid-webhook`.

- [ ] **Step 6: Verify detection ran against real data**

On the emulator: Transactions tab → pull-to-refresh (`adb -s emulator-5554 shell input swipe 540 900 540 1900 1200`). Then (test user id `ccbd42ef-cba6-4f05-a100-a83a727255b2`; never join `auth.users`):

```bash
npx supabase db query --linked -o csv "select name, direction, frequency, last_amount, next_date, occurrences, amount_change from public.recurring_streams where user_id='ccbd42ef-cba6-4f05-a100-a83a727255b2' order by next_date"
```

Expected: rows for the First Platypus Item (e.g. Netflix, Spotify monthly); no row whose category is Transfer. If zero rows, read the function logs (dashboard → Edge Functions → plaid-sync-transactions → Logs) for `recurring refresh failed` before changing anything.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/recurring.ts supabase/functions/_shared/sync.ts
git commit -m "feat: detect recurring streams at the end of every sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client data layer

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts` (append)
- Modify: `apps/mobile/src/lib/plaid.ts` (two invalidation lists)
- Create: `apps/mobile/src/lib/recurring.ts`

**Interfaces:**
- Produces: `type RecurringStream`; `useRecurringStreams()` (key `['recurring']`); `useSetStreamDismissed()` (mutate `{ id: string; dismissed: boolean }`); from `lib/recurring.ts`: `todayLocal(now?: Date): string`, `addDays(iso: string, n: number): string`, `isActive(s: RecurringStream, today: string): boolean`, `upcomingBills(streams: RecurringStream[], today: string, days: number): RecurringStream[]`, `monthlyEquivalent(s: RecurringStream): number`, `frequencyLabel(f: RecurringStream['frequency']): string`, `relativeDay(iso: string, today: string): string`.

- [ ] **Step 1: Append the queries**

At the end of `apps/mobile/src/lib/queries.ts`:

```ts
export type RecurringStream = {
  id: string;
  account_id: string;
  name: string;
  category_id: string | null;
  direction: 'outflow' | 'inflow';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  /** Ledger sign, like Transaction.amount: bills are negative. */
  average_amount: number;
  last_amount: number;
  previous_amount: number;
  /** |last| − |previous|, only when a fixed price moved; positive = costs (or pays) more. */
  amount_change: number | null;
  last_date: string;
  /** 'YYYY-MM-DD' — predicted; may be in the past if a charge is late. */
  next_date: string;
  dismissed: boolean;
};

const STREAM_COLUMNS =
  'id, account_id, name, category_id, direction, frequency, average_amount, last_amount, previous_amount, amount_change, last_date, next_date, dismissed';

/**
 * Recurring streams, written by detection at the end of each sync. Hidden
 * accounts drop out exactly as they do from the feed — `!inner` makes the
 * embedded filter drop the row rather than null the embed.
 */
export function useRecurringStreams() {
  return useQuery({
    queryKey: ['recurring'],
    queryFn: async (): Promise<RecurringStream[]> => {
      const { data, error } = await supabase
        .from('recurring_streams')
        .select(`${STREAM_COLUMNS}, accounts!inner(hidden)`)
        .eq('accounts.hidden', false)
        .order('next_date', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * "Not recurring" and its undo. The column grant makes `dismissed` the only
 * thing a client can write, and detection never touches it, so it sticks.
 */
export function useSetStreamDismissed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dismissed }: { id: string; dismissed: boolean }) => {
      const { error } = await supabase.from('recurring_streams').update({ dismissed }).eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
  });
}
```

- [ ] **Step 2: Invalidate `['recurring']` after syncs**

In `apps/mobile/src/lib/plaid.ts`, in **both** `useConnectBank`'s `onSuccess` and `useSyncTransactions`' `sync`, directly after the existing line

```ts
            await queryClient.invalidateQueries({ queryKey: ['net_worth'] });
```

(and its differently-indented twin in `useSyncTransactions`) add:

```ts
            // Detection runs at the end of every sync.
            await queryClient.invalidateQueries({ queryKey: ['recurring'] });
```

matching each site's indentation.

- [ ] **Step 3: Create `apps/mobile/src/lib/recurring.ts`**

```ts
import type { RecurringStream } from '@/lib/queries';

/**
 * Date math for the radar. LOCAL dates throughout — "due tomorrow" means the
 * user's tomorrow — so never toISOString(), which is UTC. Every parse appends
 * T00:00:00 for the reason given in lib/month.ts.
 */

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 31 } as const;
const MONTHLY_FACTOR = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 } as const;

const parse = (iso: string) => new Date(`${iso}T00:00:00`);

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as 'YYYY-MM-DD' in the device's timezone. */
export function todayLocal(now = new Date()): string {
  return isoLocal(now);
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

/** At most one missed occurrence; beyond that the stream has probably ended. */
export function isActive(s: RecurringStream, today: string): boolean {
  return today <= addDays(s.next_date, CADENCE_DAYS[s.frequency]);
}

/** Bills (not income) the user has not dismissed, due today through today + days. Input is next_date-ordered. */
export function upcomingBills(streams: RecurringStream[], today: string, days: number): RecurringStream[] {
  const end = addDays(today, days);
  return streams.filter(
    (s) => !s.dismissed && s.direction === 'outflow' && s.next_date >= today && s.next_date <= end,
  );
}

/** A stream's typical amount as a positive per-month figure. */
export function monthlyEquivalent(s: RecurringStream): number {
  return Math.abs(s.average_amount) * MONTHLY_FACTOR[s.frequency];
}

export function frequencyLabel(f: RecurringStream['frequency']): string {
  return f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Every 2 weeks' : 'Monthly';
}

/** 'Today', 'Tomorrow', 'Fri 26' within a week, else 'Oct 1'. */
export function relativeDay(iso: string, today: string): string {
  const diff = Math.round((parse(iso).getTime() - parse(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return parse(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return parse(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck` then `npx expo lint`
Expected: both exit 0 with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/queries.ts apps/mobile/src/lib/plaid.ts apps/mobile/src/lib/recurring.ts
git commit -m "feat: recurring streams query, dismiss mutation and date helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Recurring screen and row

**Files:**
- Create: `apps/mobile/src/components/recurring-row.tsx`
- Create: `apps/mobile/src/app/recurring.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx:93-95` (register the screen)

**Interfaces:**
- Consumes: everything Task 4 produces; `Category`, `useCategories` from `lib/queries.ts`.
- Produces: `RecurringRow({ stream, category, today, onPress? })`; route `/recurring`.

- [ ] **Step 1: Create the row**

`apps/mobile/src/components/recurring-row.tsx`:

```tsx
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Category, RecurringStream } from '@/lib/queries';
import { frequencyLabel, relativeDay } from '@/lib/recurring';

type Props = {
  stream: RecurringStream;
  category?: Category;
  /** Local 'YYYY-MM-DD', from todayLocal(). */
  today: string;
  onPress?: () => void;
};

export function RecurringRow({ stream, category, today, onPress }: Props) {
  const colors = useTheme();
  const tint = category?.color ?? colors.textDim;
  const when = relativeDay(stream.next_date, today);
  const change = stream.amount_change;
  // Paying more for a bill is bad news; being paid more is good news.
  const changeTone = change !== null && (change > 0) === (stream.direction === 'inflow') ? 'positive' : 'negative';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm,
        opacity: stream.dismissed ? 0.5 : 1,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <CategoryIcon name={category?.icon} size={16} color={tint} />
      </View>

      <View style={{ flex: 1, paddingRight: Spacing.sm }}>
        <AppText variant="label" numberOfLines={1}>
          {stream.name}
        </AppText>
        <AppText variant="caption" tone="dim" numberOfLines={1}>
          {frequencyLabel(stream.frequency)} · {stream.next_date < today ? `Expected ${when}` : when}
        </AppText>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <Amount value={stream.last_amount} size={15} signColor showPlus />
        {change !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <AppText variant="caption" tone={changeTone}>
              {change > 0 ? '↑' : '↓'}
            </AppText>
            <Amount value={Math.abs(change)} size={12} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 2: Create the screen**

`apps/mobile/src/app/recurring.tsx`:

```tsx
import { Repeat } from 'lucide-react-native';
import { useMemo } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { RecurringRow } from '@/components/recurring-row';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type RecurringStream, useCategories, useRecurringStreams, useSetStreamDismissed } from '@/lib/queries';
import { isActive, monthlyEquivalent, todayLocal } from '@/lib/recurring';

export default function RecurringScreen() {
  const colors = useTheme();
  const { data: streams = [], isLoading, isRefetching, refetch } = useRecurringStreams();
  const { data: categories = [] } = useCategories();
  const setDismissed = useSetStreamDismissed();
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Per render, not memoized: a screen left open past midnight moves with the day.
  const today = todayLocal();
  const live = streams.filter((s) => !s.dismissed && isActive(s, today));
  const bills = live.filter((s) => s.direction === 'outflow');
  const income = live.filter((s) => s.direction === 'inflow');
  const dismissed = streams.filter((s) => s.dismissed);
  const perMonth = bills.reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  const confirm = (s: RecurringStream) =>
    Alert.alert(s.name, s.dismissed ? 'Treat this as recurring again?' : 'Stop treating this as recurring?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: s.dismissed ? 'Restore' : 'Not recurring',
        style: s.dismissed ? 'default' : 'destructive',
        onPress: () => setDismissed.mutate({ id: s.id, dismissed: !s.dismissed }),
      },
    ]);

  const section = (title: string, list: RecurringStream[]) =>
    list.length === 0 ? null : (
      <Card>
        <AppText variant="section" tone="dim" style={{ marginBottom: Spacing.xs }}>
          {title}
        </AppText>
        {list.map((s) => (
          <RecurringRow
            key={s.id}
            stream={s}
            category={s.category_id ? categoriesById.get(s.category_id) : undefined}
            today={today}
            onPress={() => confirm(s)}
          />
        ))}
      </Card>
    );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, gap: Spacing.lg, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.textDim} />}>
      {streams.length === 0 ? (
        isLoading ? null : (
          <EmptyState
            icon={Repeat}
            title="Nothing recurring yet"
            message="Tusky spots a bill or paycheck after three regular charges. Each sync adds history."
          />
        )
      ) : (
        <>
          <View style={{ gap: Spacing.xs }}>
            <Amount value={perMonth} size={32} />
            <AppText variant="caption" tone="dim">
              a month in recurring bills
            </AppText>
          </View>
          {section('Bills & subscriptions', bills)}
          {section('Income', income)}
          {section('Not recurring', dismissed)}
        </>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/mobile/src/app/_layout.tsx`, inside the session-protected group, change

```tsx
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
```

to

```tsx
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
        {/* Pushed from Home's Upcoming card; the native header supplies Back. */}
        <Stack.Screen name="recurring" options={{ headerShown: true, title: 'Recurring' }} />
      </Stack.Protected>
```

- [ ] **Step 4: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck` then `npx expo lint`
Expected: both exit 0. (Typed routes regenerate `/recurring` when Metro or the typecheck runs; if `router.push('/recurring')` is later rejected, start Metro once to regenerate `.expo/types`.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/recurring-row.tsx apps/mobile/src/app/recurring.tsx apps/mobile/src/app/_layout.tsx
git commit -m "feat: Recurring screen with Not recurring and Restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Home — Upcoming card, and the frozen-window fix

**Files:**
- Create: `apps/mobile/src/components/upcoming-card.tsx`
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `RecurringRow` (Task 5), `upcomingBills`, `todayLocal` (Task 4), `useRecurringStreams`, `useCategories`.
- Produces: `UpcomingCard({ streams, categoriesById, today })`.

- [ ] **Step 1: Create the card**

`apps/mobile/src/components/upcoming-card.tsx`:

```tsx
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { RecurringRow } from '@/components/recurring-row';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import type { Category, RecurringStream } from '@/lib/queries';
import { upcomingBills } from '@/lib/recurring';

const UPCOMING_DAYS = 14;
const MAX_ROWS = 5;

type Props = {
  streams: RecurringStream[];
  categoriesById: Map<string, Category>;
  /** Local 'YYYY-MM-DD'. */
  today: string;
};

/** Bills due in the next two weeks. Renders nothing until detection has found anything at all. */
export function UpcomingCard({ streams, categoriesById, today }: Props) {
  if (streams.length === 0) return null;

  const due = upcomingBills(streams, today, UPCOMING_DAYS);
  const total = due.reduce((sum, s) => sum + s.last_amount, 0);

  return (
    <Card style={{ gap: Spacing.xs }}>
      <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
        Upcoming · next {UPCOMING_DAYS} days
      </AppText>

      {due.length === 0 ? (
        <AppText tone="dim">Nothing due in the next two weeks.</AppText>
      ) : (
        due.slice(0, MAX_ROWS).map((s) => (
          <RecurringRow
            key={s.id}
            stream={s}
            category={s.category_id ? categoriesById.get(s.category_id) : undefined}
            today={today}
          />
        ))
      )}
      {due.length > MAX_ROWS ? (
        <AppText variant="caption" tone="dim">
          {due.length - MAX_ROWS} more
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs }}>
        {due.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            <Amount value={total} size={14} />
            <AppText variant="caption" tone="dim">
              due
            </AppText>
          </View>
        ) : (
          <View />
        )}
        <Pressable onPress={() => router.push('/recurring')} hitSlop={8}>
          <AppText variant="label" tone="brand">
            See all ›
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into Home and fix the frozen window**

In `apps/mobile/src/app/(tabs)/index.tsx`:

Replace the imports block's two local lines

```tsx
import { useAccounts, useNetWorthHistory } from '@/lib/queries';
import { useSession } from '@/lib/session';
```

with

```tsx
import { UpcomingCard } from '@/components/upcoming-card';
import { useAccounts, useCategories, useNetWorthHistory, useRecurringStreams } from '@/lib/queries';
import { todayLocal } from '@/lib/recurring';
import { useSession } from '@/lib/session';
```

Change `import { useMemo } from 'react';` — it stays (used below for the category map).

Replace the memoized window:

```tsx
  // Memoized: computing these inline would hand the query a new key every render.
  const [from, to] = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - HISTORY_DAYS);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return [iso(start), iso(today)];
  }, []);

  const { data: history = [] } = useNetWorthHistory(from, to);
```

with

```tsx
  // Derived per render, NOT memoized with []: a memo froze the window at mount,
  // so an app left open across midnight never asked for the new day's point.
  // The strings only change when the date does, so the query key is stable
  // within a day. UTC on purpose: snapshot dates are UTC (current_date).
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - HISTORY_DAYS);
  const from = start.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  const { data: history = [], refetch: refetchHistory } = useNetWorthHistory(from, to);
  const { data: streams = [], refetch: refetchStreams } = useRecurringStreams();
  const { data: categories = [] } = useCategories();
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = todayLocal();
```

Change the refresh control's handler from `onRefresh={refetch}` to:

```tsx
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => {
            refetch();
            refetchHistory();
            refetchStreams();
          }}
          tintColor={colors.textDim}
        />
```

Insert the card between the net-worth hero `</Card>` and `{hasAccounts ? (`:

```tsx
      <UpcomingCard streams={streams} categoriesById={categoriesById} today={today} />

```

- [ ] **Step 3: Typecheck and lint**

Run (in `apps/mobile`): `npm run typecheck` then `npx expo lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/upcoming-card.tsx "apps/mobile/src/app/(tabs)/index.tsx"
git commit -m "feat: Upcoming bills on Home; the net worth window follows the date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Live verification and docs

**Files:**
- Create: `docs/superpowers/plans/2026-09-23-phase-5-handoff.md`
- Modify: `README.md` (Status), `CLAUDE.md` (status line; hide/unhide invalidation note)

- [ ] **Step 1: Reload the app**

Metro serves JS changes; no native rebuild is needed. Force-restart the app on `emulator-5554`:
`adb -s emulator-5554 shell am force-stop com.tusky.app` then `adb -s emulator-5554 shell monkey -p com.tusky.app -c android.intent.category.LAUNCHER 1`. Wait for the bundle.

- [ ] **Step 2: Home card**

Screenshot Home. Expected: an "UPCOMING · NEXT 14 DAYS" card listing the SQL rows from Task 3 Step 6 whose `next_date` falls within 14 days, in date order, with the total. Cross-check each date against the query.

- [ ] **Step 3: Recurring screen**

Tap "See all ›". Expected: native header "Recurring" with Back; the per-month figure; "Bills & subscriptions" and, if Platypus has a payroll-like inflow, "Income".

- [ ] **Step 4: Dismiss survives a sync (the never-overwrite rule)**

Tap a bill → "Not recurring". Expected: it moves to "Not recurring" and leaves Home's card and the monthly figure. Then Transactions → pull-to-refresh, return. Expected: still under "Not recurring". Confirm in SQL: `select name, dismissed from public.recurring_streams where user_id='ccbd42ef-cba6-4f05-a100-a83a727255b2' and dismissed`. Tap it → "Restore"; it returns.

- [ ] **Step 5: Hidden accounts drop their streams**

There is no hide toggle in the app, so flip one Platypus account in SQL, check, and flip it back:

```bash
npx supabase db query --linked "update public.accounts set hidden = true where item_id = '0b323fc7-c36f-42f7-9bfa-869b4f64da38' and type = 'credit'"
```

Pull-to-refresh on Home. Expected: streams on that account are gone from the card and the screen. Then run the same statement with `hidden = false` and confirm they return.

- [ ] **Step 6: Write the handoff and update the docs**

`docs/superpowers/plans/2026-09-23-phase-5-handoff.md` — sections: what shipped (table: DB / Functions / Client); verified live (list the Step 2–5 results with the actual rows seen); known and accepted (copy the spec's list, plus the single-Item snapshot gap); open items (hide/unhide toggle must now also invalidate `['recurring']`; no test runner in `apps/mobile`; `plaid-exchange-token` ordering from Phase 4).

`README.md` Status: change the Phase 5 line to `- ✅ **Phase 5** — recurring transactions and bills radar: detected bills, subscriptions and paychecks, Upcoming on Home, price-change flags`, and add `- 🚧 **Phase 6 (next)** — to be brainstormed` below it.

`CLAUDE.md`: status line → `(Phases 0–5 done; Phase 6 not yet chosen)`; in Conventions, add one bullet:
`- Recurring streams are derived: detection (`_shared/recurring.ts`) runs at the end of every sync and owns every column except `dismissed`, which only the user writes. Never add `dismissed` to its upsert payload.`

- [ ] **Step 7: Commit and push**

```bash
git add docs/superpowers/plans/2026-09-23-phase-5-handoff.md README.md CLAUDE.md
git commit -m "docs: Phase 5 done — handoff, status, recurring conventions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin pedro
```
