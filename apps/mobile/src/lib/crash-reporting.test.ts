/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reportCrash, sentryDsn } from './crash-reporting.ts';

test('an empty public DSN disables reporting', () => {
  assert.equal(sentryDsn(undefined), null);
  assert.equal(sentryDsn(null), null);
  assert.equal(sentryDsn(''), null);
  assert.equal(sentryDsn('   '), null);
});

test('a set DSN is kept trimmed', () => {
  assert.equal(sentryDsn(' https://key@example.ingest.sentry.io/1 '), 'https://key@example.ingest.sentry.io/1');
});

test('a crash is reported only when a DSN is set', () => {
  let seen: unknown = 'unset';
  assert.equal(
    reportCrash(null, new Error('boom'), (error) => {
      seen = error;
    }),
    false,
  );
  assert.equal(seen, 'unset');

  const error = new Error('boom');
  assert.equal(
    reportCrash('https://dsn', error, (value) => {
      seen = value;
    }),
    true,
  );
  assert.equal(seen, error);
});

test('a reporter that throws does not escape the fallback', () => {
  assert.equal(
    reportCrash('https://dsn', new Error('boom'), () => {
      throw new Error('sentry down');
    }),
    false,
  );
});
