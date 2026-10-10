/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appleCanceled,
  appleDisplayName,
  appleSub,
  deleteProofKind,
  hasProvider,
  isRelayEmail,
  nameSuggestion,
} from './apple.ts';

test('Apple\'s name becomes "Given Family", and missing parts are skipped', () => {
  assert.equal(appleDisplayName({ givenName: 'Ada', familyName: 'Lovelace' }), 'Ada Lovelace');
  assert.equal(appleDisplayName({ givenName: 'Ada', middleName: 'King', familyName: 'Lovelace' }), 'Ada Lovelace');
  assert.equal(appleDisplayName({ givenName: 'Ada', familyName: null }), 'Ada');
  assert.equal(appleDisplayName({ givenName: null, familyName: '  Lovelace ' }), 'Lovelace');
});

test('no name from Apple means no name', () => {
  assert.equal(appleDisplayName(null), null);
  assert.equal(appleDisplayName(undefined), null);
  assert.equal(appleDisplayName({ givenName: null, middleName: null, familyName: null }), null);
  assert.equal(appleDisplayName({ givenName: '  ', familyName: '' }), null);
});

test('a Hide My Email address is told apart from a normal one', () => {
  assert.equal(isRelayEmail('x7k2q9@privaterelay.appleid.com'), true);
  assert.equal(isRelayEmail('X7K2Q9@PrivateRelay.AppleID.com'), true);
  assert.equal(isRelayEmail('ada@gmail.com'), false);
  assert.equal(isRelayEmail('ada@evil-privaterelay.appleid.com.example.com'), false);
  assert.equal(isRelayEmail(null), false);
  assert.equal(isRelayEmail(undefined), false);
});

test('the name field starts empty when the profile name is only a relay address\'s random local part', () => {
  assert.equal(nameSuggestion('x7k2q9_abc', 'x7k2q9_abc@privaterelay.appleid.com'), '');
  assert.equal(nameSuggestion('X7K2Q9_ABC', 'x7k2q9_abc@privaterelay.appleid.com'), '');
});

test('a real name is kept, even on a relay address', () => {
  assert.equal(nameSuggestion('Ada Lovelace', 'x7k2q9_abc@privaterelay.appleid.com'), 'Ada Lovelace');
});

test('a normal email keeps its local part as the suggestion, like email sign-up does today', () => {
  assert.equal(nameSuggestion('ada', 'ada@gmail.com'), 'ada');
  assert.equal(nameSuggestion(undefined, 'ada@gmail.com'), '');
  assert.equal(nameSuggestion('  ', undefined), '');
});

test('hasProvider and appleSub read the identities', () => {
  const apple = { provider: 'apple', identity_data: { sub: '000123.abc.4567' } };
  const email = { provider: 'email', identity_data: { sub: 'user-id' } };
  assert.equal(hasProvider([apple], 'apple'), true);
  assert.equal(hasProvider([apple], 'email'), false);
  assert.equal(hasProvider([apple, email], 'email'), true);
  assert.equal(hasProvider([], 'apple'), false);
  assert.equal(hasProvider(undefined, 'apple'), false);
  assert.equal(appleSub([email, apple]), '000123.abc.4567');
  assert.equal(appleSub([email]), null);
  assert.equal(appleSub(undefined), null);
  assert.equal(appleSub([{ provider: 'apple', identity_data: {} }]), null);
  assert.equal(appleSub([{ provider: 'apple', identity_data: { sub: 42 } }]), null);
});

test('deleting an account re-confirms with Apple only on iOS, and only for a person with an Apple identity', () => {
  const apple = { provider: 'apple' };
  const email = { provider: 'email' };
  assert.equal(deleteProofKind([apple], 'ios'), 'apple');
  assert.equal(deleteProofKind([apple, email], 'ios'), 'apple');
  assert.equal(deleteProofKind([email], 'ios'), 'password');
  assert.equal(deleteProofKind([apple], 'android'), 'password');
  assert.equal(deleteProofKind([email], 'android'), 'password');
  assert.equal(deleteProofKind(undefined, 'ios'), 'password');
});

test('cancelling Apple\'s sheet is recognised and nothing else is', () => {
  assert.equal(appleCanceled({ code: 'ERR_REQUEST_CANCELED' }), true);
  assert.equal(appleCanceled({ code: 'ERR_REQUEST_FAILED' }), false);
  assert.equal(appleCanceled(new Error('boom')), false);
  assert.equal(appleCanceled(null), false);
  assert.equal(appleCanceled('ERR_REQUEST_CANCELED'), false);
});
