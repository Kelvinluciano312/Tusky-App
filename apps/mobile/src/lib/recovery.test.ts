/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PASSWORD_RESET_REDIRECT,
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
