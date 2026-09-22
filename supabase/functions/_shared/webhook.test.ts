import { assertEquals } from 'jsr:@std/assert';
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from 'npm:jose@5';

import { classifyWebhook, type PlaidJwk, verifyPlaidWebhook } from './webhook.ts';

// Plays Plaid's side: a real ES256 key pair, published under KID.
const KID = 'test-kid';
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const JWK: PlaidJwk = { ...(await exportJWK(publicKey)), alg: 'ES256', kid: KID, use: 'sig', expired_at: null };
const getKey = (kid: string) => Promise.resolve(kid === KID ? JWK : null);

// Plaid sends 2-space-indented JSON and hashes it exactly as sent.
const BODY = JSON.stringify(
  { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1' },
  null,
  2,
);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const now = () => Math.floor(Date.now() / 1000);

async function sign(body: string, opts: { iat?: number; key?: KeyLike } = {}): Promise<string> {
  return await new SignJWT({ request_body_sha256: await sha256Hex(body) })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt(opts.iat ?? now())
    .sign(opts.key ?? privateKey);
}

Deno.test('verifyPlaidWebhook accepts a correctly signed webhook', async () => {
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY), getKey), true);
});

Deno.test('verifyPlaidWebhook tolerates a few seconds of clock skew', async () => {
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY, { iat: now() + 10 }), getKey), true);
});

Deno.test('verifyPlaidWebhook rejects a body that differs from the signed one', async () => {
  const token = await sign(BODY);
  const reformatted = JSON.stringify(JSON.parse(BODY)); // same data, different bytes
  assertEquals(await verifyPlaidWebhook(reformatted, token, getKey), false);
});

Deno.test('verifyPlaidWebhook rejects a token older than 5 minutes', async () => {
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY, { iat: now() - 6 * 60 }), getKey), false);
});

Deno.test('verifyPlaidWebhook rejects a signature from a different key under the same kid', async () => {
  const other = await generateKeyPair('ES256');
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY, { key: other.privateKey }), getKey), false);
});

Deno.test('verifyPlaidWebhook rejects a non-ES256 token', async () => {
  const token = await new SignJWT({ request_body_sha256: await sha256Hex(BODY) })
    .setProtectedHeader({ alg: 'HS256', kid: KID })
    .setIssuedAt()
    .sign(new TextEncoder().encode('a-shared-secret-anyone-could-guess'));
  assertEquals(await verifyPlaidWebhook(BODY, token, getKey), false);
});

Deno.test('verifyPlaidWebhook rejects a missing or malformed header', async () => {
  assertEquals(await verifyPlaidWebhook(BODY, null, getKey), false);
  assertEquals(await verifyPlaidWebhook(BODY, 'not-a-jwt', getKey), false);
});

Deno.test('verifyPlaidWebhook rejects an unknown kid', async () => {
  const noKeys = () => Promise.resolve(null);
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY), noKeys), false);
});

Deno.test('verifyPlaidWebhook rejects a key Plaid has expired', async () => {
  const expired = () => Promise.resolve({ ...JWK, expired_at: 1_700_000_000 });
  assertEquals(await verifyPlaidWebhook(BODY, await sign(BODY), expired), false);
});

Deno.test('classifyWebhook syncs on SYNC_UPDATES_AVAILABLE', () => {
  assertEquals(classifyWebhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }), 'sync');
});

Deno.test('classifyWebhook syncs on LOGIN_REPAIRED, since a successful sync is what sets active', () => {
  assertEquals(classifyWebhook({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED' }), 'sync');
});

Deno.test('classifyWebhook marks ITEM_LOGIN_REQUIRED errors', () => {
  assertEquals(
    classifyWebhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'ITEM_LOGIN_REQUIRED' } }),
    'login_required',
  );
});

Deno.test('classifyWebhook ignores other Item errors', () => {
  assertEquals(
    classifyWebhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'INSTITUTION_DOWN' } }),
    'ignore',
  );
});

Deno.test('classifyWebhook ignores PENDING_DISCONNECT, which would flap against a successful sync', () => {
  assertEquals(classifyWebhook({ webhook_type: 'ITEM', webhook_code: 'PENDING_DISCONNECT' }), 'ignore');
});

Deno.test('classifyWebhook ignores a known code under the wrong type', () => {
  assertEquals(classifyWebhook({ webhook_type: 'ITEM', webhook_code: 'SYNC_UPDATES_AVAILABLE' }), 'ignore');
});
