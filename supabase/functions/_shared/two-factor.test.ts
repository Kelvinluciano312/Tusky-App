import { assertEquals } from 'jsr:@std/assert';

import { amrOfToken, hasOtpProof, secondStepRequired } from './two-factor.ts';

const OTP = [{ method: 'otp', timestamp: 1 }];
const PASSWORD = [{ method: 'password', timestamp: 1 }];

function tokenWith(claims: unknown): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

Deno.test('hasOtpProof: only an otp entry counts', () => {
  assertEquals(hasOtpProof(OTP), true);
  assertEquals(hasOtpProof([...PASSWORD, ...OTP]), true);
  assertEquals(hasOtpProof(PASSWORD), false);
  assertEquals(hasOtpProof([]), false);
});

Deno.test('hasOtpProof: junk is no proof', () => {
  for (const junk of [null, undefined, 'otp', 7, {}, { method: 'otp' }, [null], ['otp'], [{ method: 5 }]]) {
    assertEquals(hasOtpProof(junk), false);
  }
});

Deno.test('secondStepRequired: only when the flag is on and no code was proven', () => {
  assertEquals(secondStepRequired(true, PASSWORD), true);
  assertEquals(secondStepRequired(true, null), true);
  assertEquals(secondStepRequired(true, OTP), false);
  assertEquals(secondStepRequired(false, PASSWORD), false);
  assertEquals(secondStepRequired(null, PASSWORD), false);
  assertEquals(secondStepRequired(undefined, undefined), false);
});

Deno.test('amrOfToken: reads the claim, base64url and all', () => {
  assertEquals(amrOfToken(tokenWith({ sub: 'u', amr: OTP })), OTP);
  assertEquals(amrOfToken(tokenWith({ sub: 'u', amr: PASSWORD, note: '??>>' })), PASSWORD);
  assertEquals(amrOfToken(tokenWith({ sub: 'u' })), null);
});

Deno.test('amrOfToken: a malformed token has no proof', () => {
  for (const bad of ['', 'abc', 'a.b.c', 'a..c', 'a.%%%.c']) {
    assertEquals(amrOfToken(bad), null);
  }
});
