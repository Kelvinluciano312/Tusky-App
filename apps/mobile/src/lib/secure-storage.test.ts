/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHUNK_SIZE, createSecureStorage, type KeyValueStore, type SecureBackend } from './secure-storage.ts';

/** A stand-in for expo-secure-store, with the Android size ceiling it really has. */
function fakeSecure(limit = 2048): SecureBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItemAsync: (k) => Promise.resolve(store.get(k) ?? null),
    setItemAsync: (k, v) => {
      if (v.length > limit) return Promise.reject(new Error(`value too large: ${v.length}`));
      store.set(k, v);
      return Promise.resolve();
    },
    deleteItemAsync: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
}

function fakeLegacy(seed: Record<string, string> = {}): KeyValueStore & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: (k) => Promise.resolve(store.get(k) ?? null),
    setItem: (k, v) => {
      store.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
}

const KEY = 'sb-abcdef-auth-token';
/** Bigger than the Android ceiling, so it must be split to be stored at all. */
const bigSession = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r'.repeat(900) });

test('a value round-trips unchanged', async () => {
  const storage = createSecureStorage(fakeSecure());
  await storage.setItem(KEY, 'hello');
  assert.equal(await storage.getItem(KEY), 'hello');
});

test('a missing key reads as null', async () => {
  assert.equal(await createSecureStorage(fakeSecure()).getItem(KEY), null);
});

test('a session larger than the Android ceiling round-trips', async () => {
  const secure = fakeSecure();
  const storage = createSecureStorage(secure);
  await storage.setItem(KEY, bigSession);
  assert.equal(await storage.getItem(KEY), bigSession);
  // Every stored piece is under the ceiling, which is the whole point.
  for (const value of secure.store.values()) assert.ok(value.length <= CHUNK_SIZE);
});

test('removing a value clears every chunk, leaving nothing behind', async () => {
  const secure = fakeSecure();
  const storage = createSecureStorage(secure);
  await storage.setItem(KEY, bigSession);
  await storage.removeItem(KEY);
  assert.equal(await storage.getItem(KEY), null);
  assert.equal(secure.store.size, 0);
});

test('overwriting with a shorter value leaves no stale chunks behind', async () => {
  const secure = fakeSecure();
  const storage = createSecureStorage(secure);
  await storage.setItem(KEY, bigSession);
  await storage.setItem(KEY, 'small');
  assert.equal(await storage.getItem(KEY), 'small');
  // A leftover chunk from the long value would be a refresh token left on disk.
  assert.equal(secure.store.size, 2); // the manifest and one chunk
});

test('a half-written value reads as signed out rather than as garbage', async () => {
  const secure = fakeSecure();
  const storage = createSecureStorage(secure);
  await storage.setItem(KEY, bigSession);
  // Simulate a write or wipe interrupted between chunks.
  secure.store.delete(`${KEY}.1`);
  assert.equal(await storage.getItem(KEY), null);
});

test('an existing AsyncStorage session moves into secure storage on first read', async () => {
  const secure = fakeSecure();
  const legacy = fakeLegacy({ [KEY]: bigSession });
  const storage = createSecureStorage(secure, legacy);

  assert.equal(await storage.getItem(KEY), bigSession);
  // Moved, not copied: leaving it behind would defeat the point.
  assert.equal(legacy.store.has(KEY), false);
  // And it is there next time without the legacy store.
  assert.equal(await createSecureStorage(secure).getItem(KEY), bigSession);
});

test('secure storage wins when both hold a value', async () => {
  const secure = fakeSecure();
  const legacy = fakeLegacy({ [KEY]: 'stale' });
  const storage = createSecureStorage(secure, legacy);
  await storage.setItem(KEY, 'current');
  assert.equal(await storage.getItem(KEY), 'current');
});

test('a read never throws, so a broken keystore signs the user out instead of crashing', async () => {
  const broken: SecureBackend = {
    getItemAsync: () => Promise.reject(new Error('keystore unavailable')),
    setItemAsync: () => Promise.reject(new Error('keystore unavailable')),
    deleteItemAsync: () => Promise.reject(new Error('keystore unavailable')),
  };
  const storage = createSecureStorage(broken);
  assert.equal(await storage.getItem(KEY), null);
  await storage.setItem(KEY, 'x');
  await storage.removeItem(KEY);
});

/** Records the options every keystore call receives. */
function optionsSpy<O>(): SecureBackend<O> & { seen: { op: string; key: string; options: O | undefined }[] } {
  const store = new Map<string, string>();
  const seen: { op: string; key: string; options: O | undefined }[] = [];
  return {
    seen,
    getItemAsync: (k, options) => (seen.push({ op: 'get', key: k, options }), Promise.resolve(store.get(k) ?? null)),
    setItemAsync: (k, v, options) => (seen.push({ op: 'set', key: k, options }), store.set(k, v), Promise.resolve()),
    deleteItemAsync: (k, options) => (seen.push({ op: 'delete', key: k, options }), store.delete(k), Promise.resolve()),
  };
}

test('keychain options reach every keystore call, chunks and deletes included', async () => {
  const options = { keychainAccessible: 9 };
  const spy = optionsSpy<typeof options>();
  const storage = createSecureStorage(spy, undefined, options);
  await storage.setItem(KEY, bigSession);
  await storage.getItem(KEY);
  await storage.setItem(KEY, 'small'); // clears the old chunks first
  await storage.removeItem(KEY);
  assert.ok(spy.seen.length > 10);
  assert.ok(spy.seen.some((c) => c.op === 'set' && c.key === `${KEY}.1`));
  assert.ok(spy.seen.some((c) => c.op === 'delete' && c.key === `${KEY}.1`));
  for (const call of spy.seen) assert.equal(call.options, options, `${call.op} ${call.key}`);
});

test('without options nothing extra is passed', async () => {
  const spy = optionsSpy<{ keychainAccessible: number }>();
  const storage = createSecureStorage(spy);
  await storage.setItem(KEY, 'x');
  await storage.getItem(KEY);
  for (const call of spy.seen) assert.equal(call.options, undefined);
});

test('the legacy migration also writes with the options', async () => {
  const options = { keychainAccessible: 9 };
  const spy = optionsSpy<typeof options>();
  const storage = createSecureStorage(spy, fakeLegacy({ [KEY]: 'old' }), options);
  assert.equal(await storage.getItem(KEY), 'old');
  for (const call of spy.seen) assert.equal(call.options, options, `${call.op} ${call.key}`);
});
