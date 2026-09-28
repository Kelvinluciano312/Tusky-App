import { assertEquals } from 'jsr:@std/assert';

import { describeMembershipError, formatCode, generateCode, normalizeCode, parseHerdRequest } from './herd.ts';

const ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

Deno.test('generateCode makes 8 Crockford characters that normalize to themselves', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assertEquals(code.length, 8);
    assertEquals(normalizeCode(code), code);
  }
});

Deno.test('generateCode maps each byte into the alphabet', () => {
  assertEquals(generateCode(() => new Uint8Array([0, 31, 32, 63, 255, 10, 17, 18])), '0Z0ZZAHJ');
});

Deno.test('normalizeCode forgives case, dashes, spaces and look-alikes', () => {
  assertEquals(normalizeCode('abcd-efgh'), 'ABCDEFGH');
  assertEquals(normalizeCode(' ab cd ef gh '), 'ABCDEFGH');
  assertEquals(normalizeCode('O0IL-1234'), '0011' + '1234');
});

Deno.test('normalizeCode takes the code from a pasted invite link', () => {
  assertEquals(normalizeCode('tusky:///join/ABCD-EFGH'), 'ABCDEFGH');
});

Deno.test('normalizeCode rejects the wrong length, U, symbols and non-strings', () => {
  for (const input of ['ABCDEFG', 'ABCDEFGHJ', 'ABCDEFGU', 'ABCD_EFG', '', null, 42]) {
    assertEquals(normalizeCode(input), null);
  }
});

Deno.test('formatCode splits the code in two', () => {
  assertEquals(formatCode('ABCDEFGH'), 'ABCD-EFGH');
});

Deno.test('parseHerdRequest accepts each action', () => {
  assertEquals(parseHerdRequest({ action: 'create_invite' }), { action: 'create_invite' });
  assertEquals(parseHerdRequest({ action: 'leave' }), { action: 'leave' });
  assertEquals(parseHerdRequest({ action: 'preview_invite', code: 'abcd-efgh' }), {
    action: 'preview_invite',
    code: 'ABCDEFGH',
  });
  assertEquals(parseHerdRequest({ action: 'revoke_invite', code: 'ABCDEFGH' }), {
    action: 'revoke_invite',
    code: 'ABCDEFGH',
  });
  assertEquals(parseHerdRequest({ action: 'join', code: 'ABCDEFGH' }), {
    action: 'join',
    code: 'ABCDEFGH',
    private_account_ids: [],
  });
  assertEquals(parseHerdRequest({ action: 'join', code: 'ABCDEFGH', private_account_ids: [ID] }), {
    action: 'join',
    code: 'ABCDEFGH',
    private_account_ids: [ID],
  });
  assertEquals(parseHerdRequest({ action: 'remove_member', user_id: ID }), { action: 'remove_member', user_id: ID });
});

Deno.test('parseHerdRequest rejects bad input', () => {
  for (const body of [
    null,
    {},
    { action: 'nope' },
    { action: 'join' },
    { action: 'join', code: 'ABCDEFGH', private_account_ids: ['x'] },
    { action: 'join', code: 'ABCDEFGH', private_account_ids: ID },
    { action: 'remove_member' },
    { action: 'remove_member', user_id: 'abc' },
    { action: 'preview_invite', code: 'short' },
  ]) {
    assertEquals('error' in parseHerdRequest(body), true);
  }
});

Deno.test('describeMembershipError knows the SQL refusals and nothing else', () => {
  assertEquals(describeMembershipError('invite_invalid')?.status, 404);
  for (const m of ['already_member', 'not_alone', 'herd_full', 'alone']) {
    assertEquals(describeMembershipError(m)?.status, 409);
  }
  assertEquals(describeMembershipError('deadlock detected'), null);
  assertEquals(describeMembershipError(undefined), null);
});
