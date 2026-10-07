import { assertEquals } from 'jsr:@std/assert';

import {
  claimsOfToken,
  hasPasswordMethod,
  markableSession,
  reservedAttempt,
  MAX_WRONG_CODES,
  MAX_WRONG_CODES_PER_USER,
  secondStepRequired,
  sessionIdOfClaims,
  verifyFailure,
} from './two-factor.ts';

const SID = '3f1c2a52-7b1e-4a86-9d0b-1c2d3e4f5a6b';
const OTP = [{ method: 'otp', timestamp: 1 }];
const PASSWORD = [{ method: 'password', timestamp: 1 }];

function tokenWith(claims: unknown): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

Deno.test('claimsOfToken: reads the claims, base64url and all', () => {
  assertEquals(claimsOfToken(tokenWith({ sub: 'u', session_id: SID, amr: PASSWORD })), {
    sub: 'u',
    session_id: SID,
    amr: PASSWORD,
  });
  assertEquals(claimsOfToken(tokenWith({ note: '??>>' }))?.note, '??>>');
});

Deno.test('claimsOfToken: a malformed token has no claims', () => {
  for (const bad of ['', 'abc', 'a.b.c', 'a..c', 'a.%%%.c', `a.${btoa('[1]')}.c`, `a.${btoa('null')}.c`]) {
    assertEquals(claimsOfToken(bad), null);
  }
});

Deno.test('sessionIdOfClaims: only a uuid string counts', () => {
  assertEquals(sessionIdOfClaims({ session_id: SID }), SID);
  for (const junk of [null, {}, { session_id: 7 }, { session_id: '' }, { session_id: 'abc' }, { session_id: [SID] }]) {
    assertEquals(sessionIdOfClaims(junk as Record<string, unknown> | null), null);
  }
});

Deno.test('hasPasswordMethod: only a password entry counts', () => {
  assertEquals(hasPasswordMethod(PASSWORD), true);
  assertEquals(hasPasswordMethod([...OTP, ...PASSWORD]), true);
  assertEquals(hasPasswordMethod(OTP), false);
  assertEquals(hasPasswordMethod([{ method: 'recovery' }]), false);
  assertEquals(hasPasswordMethod([]), false);
  for (const junk of [null, undefined, 'password', 7, {}, { method: 'password' }, [null], ['password'], [{ method: 5 }]]) {
    assertEquals(hasPasswordMethod(junk), false);
  }
});

Deno.test('markableSession: a password session with an id may be marked', () => {
  assertEquals(markableSession({ session_id: SID, amr: PASSWORD }), { sessionId: SID });
  assertEquals(markableSession({ session_id: SID, amr: [...PASSWORD, ...OTP] }), { sessionId: SID });
});

Deno.test('markableSession: an otp-only (mailbox) session never can be', () => {
  assertEquals(markableSession({ session_id: SID, amr: OTP }), null);
  assertEquals(markableSession({ session_id: SID, amr: [{ method: 'recovery' }] }), null);
  assertEquals(markableSession({ session_id: SID }), null);
});

Deno.test('markableSession: no session id, no mark', () => {
  assertEquals(markableSession({ amr: PASSWORD }), null);
  assertEquals(markableSession({ session_id: 'nope', amr: PASSWORD }), null);
  assertEquals(markableSession(null), null);
});

Deno.test('verifyFailure: wrong codes, vendor limits and outages are told apart', () => {
  assertEquals(verifyFailure(403, 'otp_expired'), 'wrong_code');
  assertEquals(verifyFailure(400, 'invalid_credentials'), 'wrong_code');
  // A config or provider error is not a wrong code: it must not burn an attempt.
  assertEquals(verifyFailure(400, 'captcha_failed'), 'unavailable');
  assertEquals(verifyFailure(422, 'validation_failed'), 'unavailable');
  assertEquals(verifyFailure(403), 'unavailable');
  assertEquals(verifyFailure(403, 'otp_disabled'), 'unavailable');
  assertEquals(verifyFailure(429), 'too_many_attempts');
  assertEquals(verifyFailure(429, 'over_request_rate_limit'), 'too_many_attempts');
  assertEquals(verifyFailure(500), 'unavailable');
  assertEquals(verifyFailure(502), 'unavailable');
  assertEquals(verifyFailure(0), 'unavailable');
  assertEquals(verifyFailure(undefined), 'unavailable');
});

Deno.test('the per-user cap is wider than the per-session cap, and both are positive', () => {
  assertEquals(MAX_WRONG_CODES > 0, true);
  assertEquals(MAX_WRONG_CODES_PER_USER > MAX_WRONG_CODES, true);
});

Deno.test('reservedAttempt: a positive id (bigint may arrive as a string) is a reservation, anything else a refusal', () => {
  assertEquals(reservedAttempt(7), 7);
  assertEquals(reservedAttempt('12'), 12);
  for (const no of [null, undefined, 0, -1, 1.5, 'x', '', {}, [], true]) assertEquals(reservedAttempt(no), null);
});

Deno.test('secondStepRequired: only when the flag is on and the session is not verified', () => {
  assertEquals(secondStepRequired(true, false), true);
  assertEquals(secondStepRequired(true, true), false);
  assertEquals(secondStepRequired(false, false), false);
  assertEquals(secondStepRequired(null, false), false);
  assertEquals(secondStepRequired(undefined, false), false);
});
