/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import {
  PASSWORD_RESET_REDIRECT,
  nativeIntentPath,
  parseRecoveryUrl,
  passwordUpdateMessage,
  recoveryExchangeMessage,
  resetRequestMessage,
} from './recovery.ts';

test('the reset email redirects into the app scheme', () => {
  assert.equal(PASSWORD_RESET_REDIRECT, 'tusky://reset-password');
});

test('a token-hash link is a recovery session', () => {
  assert.deepEqual(
    parseRecoveryUrl('tusky://reset-password?token_hash=abc123&type=recovery'),
    { kind: 'token_hash', tokenHash: 'abc123' },
  );
});

test('a PKCE code on the reset path is exchanged', () => {
  assert.deepEqual(parseRecoveryUrl('tusky://reset-password?code=auth-code'), {
    kind: 'code',
    code: 'auth-code',
  });
});

test('an implicit grant keeps the fragment tokens', () => {
  const url =
    'tusky://reset-password#access_token=access&refresh_token=refresh&type=recovery';
  assert.deepEqual(parseRecoveryUrl(url), {
    kind: 'session',
    accessToken: 'access',
    refreshToken: 'refresh',
  });
});

test('query tokens are accepted when the fragment was rewritten', () => {
  const url =
    'tusky://reset-password?access_token=access&refresh_token=refresh&type=recovery';
  assert.deepEqual(parseRecoveryUrl(url), {
    kind: 'session',
    accessToken: 'access',
    refreshToken: 'refresh',
  });
});

test('an emailed recovery code in the link is an otp', () => {
  assert.deepEqual(parseRecoveryUrl('tusky://reset-password?token=12345678&type=recovery'), {
    kind: 'otp',
    token: '12345678',
  });
});

test('other deep links and other auth types are left alone', () => {
  assert.equal(parseRecoveryUrl('tusky://join/ABCD2345'), null);
  assert.equal(parseRecoveryUrl('tusky://reset-password?type=signup&code=nope'), null);
  assert.equal(parseRecoveryUrl('not a url'), null);
  assert.equal(parseRecoveryUrl('https://example.com/reset-password?code=x'), null);
});

test('the studio reset page is the same token-hash link', () => {
  const hash = 'abc123';
  for (const url of [
    `https://studiosouroboros.com/tusky/reset?token_hash=${hash}&type=recovery`,
    `https://studiosouroboros.com/tusky/reset/?token_hash=${hash}&type=recovery`,
    `https://studiosouroboros.com/tusky/reset.html?token_hash=${hash}&type=recovery`,
  ]) {
    assert.deepEqual(parseRecoveryUrl(url), { kind: 'token_hash', tokenHash: hash });
  }
});

test('other https hosts and paths are not reset links', () => {
  assert.equal(
    parseRecoveryUrl('https://example.com/tusky/reset?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('http://studiosouroboros.com/tusky/reset?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('https://studiosouroboros.com/tusky/plaid-oauth?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('https://studiosouroboros.com/tusky/resetting?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('https://studiosouroboros.com/tusky/reset/extra?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('https://studiosouroboros.com/reset?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(
    parseRecoveryUrl('https://studiosouroboros.com/tusky/reset?type=signup&code=nope'),
    null,
  );
});

test('a studio reset link is not an expo-router route', () => {
  // There is no /tusky/reset screen. Null keeps the router off the unmatched
  // route; listenForRecovery applies the original URL.
  assert.equal(
    nativeIntentPath('https://studiosouroboros.com/tusky/reset?token_hash=abc&type=recovery'),
    null,
  );
  assert.equal(nativeIntentPath('https://studiosouroboros.com/tusky/reset/'), null);
  assert.equal(nativeIntentPath('https://studiosouroboros.com/tusky/reset.html?token_hash=abc'), null);
});

test('plaid oauth and ordinary links stay with the router', () => {
  const oauth = 'https://studiosouroboros.com/tusky/plaid-oauth?oauth_state_id=xyz';
  assert.equal(nativeIntentPath(oauth), oauth);
  const scheme = 'tusky://reset-password?token_hash=abc&type=recovery';
  assert.equal(nativeIntentPath(scheme), scheme);
  assert.equal(nativeIntentPath('tusky://join/ABCD2345'), 'tusky://join/ABCD2345');
});

test('Android verifies the reset App Link', () => {
  const app = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as {
    expo: {
      android?: {
        intentFilters?: {
          action?: string;
          autoVerify?: boolean;
          category?: string[];
          data?: { scheme?: string; host?: string; pathPrefix?: string }[];
        }[];
      };
    };
  };
  const filters = app.expo.android?.intentFilters ?? [];
  const reset = filters.find((filter) =>
    (Array.isArray(filter.data) ? filter.data : []).some((data) => data.pathPrefix === '/tusky/reset'),
  );
  assert.ok(reset);
  assert.equal(reset.autoVerify, true);
  assert.equal(reset.action, 'VIEW');
  assert.ok(reset.category?.includes('BROWSABLE'));
  assert.ok(reset.category?.includes('DEFAULT'));
  const data = reset.data?.find((entry) => entry.pathPrefix === '/tusky/reset');
  assert.equal(data?.scheme, 'https');
  assert.equal(data?.host, 'studiosouroboros.com');
});

test('a reset email that was sent, or an unknown address, says nothing', () => {
  assert.equal(resetRequestMessage(null), null);
  assert.equal(resetRequestMessage({ message: 'User not found', status: 400 }), null);
});

test('reset emails that are rate limited or invalid say so', () => {
  assert.match(resetRequestMessage({ status: 429, message: 'rate limit' }) ?? '', /wait a minute/i);
  assert.match(
    resetRequestMessage({ message: 'For security purposes, you can only request this after 60 seconds' }) ?? '',
    /wait a minute/i,
  );
  assert.match(resetRequestMessage({ message: 'Unable to validate email address' }) ?? '', /email/i);
  assert.match(resetRequestMessage({ message: 'Network request failed' }) ?? '', /connection/i);
});

test('a used or expired recovery link says to request another', () => {
  assert.match(recoveryExchangeMessage({ message: 'Email link is invalid or has expired' }) ?? '', /expired/i);
  assert.match(recoveryExchangeMessage({ message: 'Code verifier not found' }) ?? '', /code from the email/i);
  assert.equal(recoveryExchangeMessage(null), null);
});

test('saving a password words the rate limit and a reused password', () => {
  assert.match(passwordUpdateMessage({ status: 429, message: 'too many' }), /wait a minute/i);
  assert.match(passwordUpdateMessage({ message: 'New password should be different from the old password.' }), /not used before/i);
  assert.match(passwordUpdateMessage({ message: 'Auth session missing' }), /expired/i);
  assert.match(passwordUpdateMessage({ message: 'fetch failed' }), /connection/i);
});
