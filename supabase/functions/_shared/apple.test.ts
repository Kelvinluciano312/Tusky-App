import { assert, assertEquals } from 'jsr:@std/assert';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  type KeyLike,
  jwtVerify,
  SignJWT,
} from 'npm:jose@5';

import {
  APPLE_BUNDLE_ID,
  APPLE_ISSUER,
  appleClientSecret,
  appleEnv,
  type AppleEnv,
  exchangeAppleCode,
  type FormPost,
  revokeAppleToken,
  verifyAppleIdentity,
  verifyAppleNotification,
} from './apple.ts';

// Plays Apple's side: a real RS256 key pair, published under KID.
const KID = 'apple-test-kid';
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: KID, use: 'sig' }] });

const NOW = new Date('2026-10-10T12:00:00Z');
const at = (offsetSeconds: number) => Math.floor(NOW.getTime() / 1000) + offsetSeconds;
const SUB = '001234.abcdef.5678';

async function identityToken(
  opts: { sub?: string; aud?: string; iss?: string; iat?: number; exp?: number; key?: KeyLike } = {},
): Promise<string> {
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(opts.iss ?? APPLE_ISSUER)
    .setAudience(opts.aud ?? APPLE_BUNDLE_ID)
    .setSubject(opts.sub ?? SUB)
    .setIssuedAt(opts.iat ?? at(-30))
    .setExpirationTime(opts.exp ?? at(3600))
    .sign(opts.key ?? privateKey);
}

Deno.test('verifyAppleIdentity accepts a fresh token for this app and this Apple user', async () => {
  assertEquals(await verifyAppleIdentity(await identityToken(), SUB, { keys, now: NOW }), true);
});

Deno.test('verifyAppleIdentity rejects another Apple user, audience or issuer', async () => {
  assertEquals(await verifyAppleIdentity(await identityToken({ sub: 'someone-else' }), SUB, { keys, now: NOW }), false);
  assertEquals(await verifyAppleIdentity(await identityToken({ aud: 'com.other.app' }), SUB, { keys, now: NOW }), false);
  assertEquals(await verifyAppleIdentity(await identityToken({ iss: 'https://evil.example' }), SUB, { keys, now: NOW }), false);
});

Deno.test('verifyAppleIdentity rejects an expired token and one older than 10 minutes', async () => {
  const expired = await identityToken({ iat: at(-7200), exp: at(-3600) });
  assertEquals(await verifyAppleIdentity(expired, SUB, { keys, now: NOW }), false);
  const stale = await identityToken({ iat: at(-20 * 60), exp: at(3600) });
  assertEquals(await verifyAppleIdentity(stale, SUB, { keys, now: NOW }), false);
});

Deno.test('verifyAppleIdentity rejects a signature from another key and a non-RS256 token', async () => {
  const other = await generateKeyPair('RS256');
  assertEquals(await verifyAppleIdentity(await identityToken({ key: other.privateKey }), SUB, { keys, now: NOW }), false);
  const hs256 = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', kid: KID })
    .setIssuer(APPLE_ISSUER)
    .setAudience(APPLE_BUNDLE_ID)
    .setSubject(SUB)
    .setIssuedAt(at(-30))
    .setExpirationTime(at(3600))
    .sign(new TextEncoder().encode('a-shared-secret-anyone-could-guess'));
  assertEquals(await verifyAppleIdentity(hs256, SUB, { keys, now: NOW }), false);
});

Deno.test('verifyAppleIdentity rejects nothing-shaped input without throwing', async () => {
  assertEquals(await verifyAppleIdentity('', SUB, { keys, now: NOW }), false);
  assertEquals(await verifyAppleIdentity('not-a-jwt', SUB, { keys, now: NOW }), false);
  assertEquals(await verifyAppleIdentity(await identityToken(), '', { keys, now: NOW }), false);
});

// Plays the Sign in with Apple key from the developer portal (P3).
const signing = await generateKeyPair('ES256', { extractable: true });
const ENV: AppleEnv = { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: await exportPKCS8(signing.privateKey) };

Deno.test('appleEnv needs all three secrets and restores line breaks in the key', () => {
  const all: Record<string, string> = { APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'line1\\nline2' };
  assertEquals(appleEnv((k) => all[k]), { teamId: 'T', keyId: 'K', privateKey: 'line1\nline2' });
  for (const missing of Object.keys(all)) {
    assertEquals(appleEnv((k) => (k === missing ? undefined : all[k])), null);
    assertEquals(appleEnv((k) => (k === missing ? '' : all[k])), null);
  }
});

Deno.test('the client secret is an ES256 JWT with the team, key and app Apple expects', async () => {
  const secret = await appleClientSecret(ENV, NOW);
  const header = decodeProtectedHeader(secret);
  assertEquals(header.alg, 'ES256');
  assertEquals(header.kid, ENV.keyId);
  const { payload } = await jwtVerify(secret, signing.publicKey, {
    issuer: ENV.teamId,
    audience: APPLE_ISSUER,
    subject: APPLE_BUNDLE_ID,
    currentDate: NOW,
  });
  assertEquals(payload.iat, at(0));
  assertEquals(payload.exp, at(300));
});

function recordingPost(response: { status: number; body: unknown }) {
  const calls: { url: string; form: Record<string, string> }[] = [];
  const post: FormPost = (url, form) => {
    calls.push({ url, form });
    return Promise.resolve(response);
  };
  return { post, calls };
}

Deno.test('exchangeAppleCode posts the code and returns the refresh token', async () => {
  const { post, calls } = recordingPost({ status: 200, body: { refresh_token: 'r-token', access_token: 'a' } });
  assertEquals(await exchangeAppleCode(post, ENV, 'auth-code', NOW), 'r-token');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://appleid.apple.com/auth/token');
  assertEquals(Object.keys(calls[0].form).sort(), ['client_id', 'client_secret', 'code', 'grant_type']);
  assertEquals(calls[0].form.client_id, APPLE_BUNDLE_ID);
  assertEquals(calls[0].form.code, 'auth-code');
  assertEquals(calls[0].form.grant_type, 'authorization_code');
  assert(calls[0].form.client_secret.split('.').length === 3);
});

Deno.test('exchangeAppleCode is null when Apple refuses, answers oddly, or cannot be reached', async () => {
  assertEquals(await exchangeAppleCode(recordingPost({ status: 400, body: { error: 'invalid_grant' } }).post, ENV, 'c', NOW), null);
  assertEquals(await exchangeAppleCode(recordingPost({ status: 200, body: {} }).post, ENV, 'c', NOW), null);
  assertEquals(await exchangeAppleCode(recordingPost({ status: 200, body: null }).post, ENV, 'c', NOW), null);
  const down: FormPost = () => Promise.reject(new Error('network down'));
  assertEquals(await exchangeAppleCode(down, ENV, 'c', NOW), null);
});

Deno.test('revokeAppleToken posts the refresh token and is true only on 200', async () => {
  const ok = recordingPost({ status: 200, body: null });
  assertEquals(await revokeAppleToken(ok.post, ENV, 'r-token', NOW), true);
  assertEquals(ok.calls[0].url, 'https://appleid.apple.com/auth/revoke');
  assertEquals(Object.keys(ok.calls[0].form).sort(), ['client_id', 'client_secret', 'token', 'token_type_hint']);
  assertEquals(ok.calls[0].form.client_id, APPLE_BUNDLE_ID);
  assertEquals(ok.calls[0].form.token, 'r-token');
  assertEquals(ok.calls[0].form.token_type_hint, 'refresh_token');
  assertEquals(await revokeAppleToken(recordingPost({ status: 400, body: null }).post, ENV, 'r', NOW), false);
  const down: FormPost = () => Promise.reject(new Error('network down'));
  assertEquals(await revokeAppleToken(down, ENV, 'r', NOW), false);
});

async function notification(
  events: unknown,
  opts: { aud?: string; iss?: string; key?: KeyLike } = {},
): Promise<string> {
  return await new SignJWT({ events: typeof events === 'string' ? events : JSON.stringify(events) })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(opts.iss ?? APPLE_ISSUER)
    .setAudience(opts.aud ?? APPLE_BUNDLE_ID)
    .setIssuedAt(at(-5))
    .sign(opts.key ?? privateKey);
}

Deno.test('verifyAppleNotification reads the event type and the Apple user', async () => {
  const signed = await notification({ type: 'consent-revoked', sub: SUB, event_time: 1_700_000_000_000 });
  assertEquals(await verifyAppleNotification(signed, { keys, now: NOW }), { type: 'consent-revoked', sub: SUB });
});

Deno.test('verifyAppleNotification is null for a bad signature, audience, issuer or garbled events', async () => {
  const event = { type: 'account-delete', sub: SUB };
  const other = await generateKeyPair('RS256');
  assertEquals(await verifyAppleNotification(await notification(event, { key: other.privateKey }), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification(await notification(event, { aud: 'com.other.app' }), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification(await notification(event, { iss: 'https://evil.example' }), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification(await notification('{not json'), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification(await notification({ type: 'account-delete' }), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification(await notification({ sub: SUB }), { keys, now: NOW }), null);
  assertEquals(await verifyAppleNotification('not-a-jwt', { keys, now: NOW }), null);
  const noEvents = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(APPLE_ISSUER)
    .setAudience(APPLE_BUNDLE_ID)
    .setIssuedAt(at(-5))
    .sign(privateKey);
  assertEquals(await verifyAppleNotification(noEvents, { keys, now: NOW }), null);
});
