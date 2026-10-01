/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventFor, nextOnOrAfter } from './calendar.ts';

const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date(2026, 9, 1); // Oct 1, 2026, local

test('a future due date stays as it is', () => {
  assert.equal(day(nextOnOrAfter('2026-10-15', 'monthly', today)), '2026-10-15');
  assert.equal(day(nextOnOrAfter('2026-10-01', 'weekly', today)), '2026-10-01');
});

test('a late charge rolls forward by its cadence', () => {
  assert.equal(day(nextOnOrAfter('2026-09-28', 'weekly', today)), '2026-10-05');
  assert.equal(day(nextOnOrAfter('2026-09-20', 'biweekly', today)), '2026-10-04');
  assert.equal(day(nextOnOrAfter('2026-09-15', 'monthly', today)), '2026-10-15');
});

test('a monthly bill on the 31st keeps the 31st where the month has one', () => {
  assert.equal(day(nextOnOrAfter('2026-08-31', 'monthly', today)), '2026-10-31');
  assert.equal(day(nextOnOrAfter('2026-01-31', 'monthly', new Date(2026, 1, 10))), '2026-02-28');
});

test('eventFor builds an all-day repeating event with the amount in the notes', () => {
  const e = eventFor(
    { name: 'NETFLIX', direction: 'outflow', frequency: 'monthly', average_amount: -15.49, next_date: '2026-10-12' },
    'Netflix',
    today,
  );
  assert.equal(e.title, 'Netflix bill');
  assert.equal(day(e.startDate), '2026-10-12');
  assert.equal(day(e.endDate), '2026-10-13');
  assert.equal(e.allDay, true);
  assert.deepEqual(e.recurrenceRule, { frequency: 'monthly', interval: 1 });
  assert.match(e.notes, /\$15\.49, monthly/);
});

test('every two weeks is weekly with an interval of 2; deposits say so', () => {
  const e = eventFor(
    { name: 'ACME PAYROLL', direction: 'inflow', frequency: 'biweekly', average_amount: 2100, next_date: '2026-10-09' },
    'Acme payroll',
    today,
  );
  assert.equal(e.title, 'Acme payroll deposit');
  assert.deepEqual(e.recurrenceRule, { frequency: 'weekly', interval: 2 });
  assert.match(e.notes, /every 2 weeks/);
});
