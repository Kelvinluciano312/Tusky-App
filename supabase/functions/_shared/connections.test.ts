import { assertEquals, assertThrows } from 'jsr:@std/assert';

import { isDuplicateLink, isItemGone, planDisconnect } from './connections.ts';

const plaidError = (error_code: string) => ({ response: { data: { error_code, error_message: 'x' } } });

Deno.test('planDisconnect: a live Item kept → remove at Plaid, then archive', () => {
  assertEquals(planDisconnect('active', 'archive'), 'remove_then_archive');
});

Deno.test('planDisconnect: a live Item deleted → remove at Plaid, then delete', () => {
  assertEquals(planDisconnect('active', 'delete'), 'remove_then_delete');
});

Deno.test('planDisconnect: a broken Item can still be removed at Plaid', () => {
  assertEquals(planDisconnect('login_required', 'archive'), 'remove_then_archive');
  assertEquals(planDisconnect('login_required', 'delete'), 'remove_then_delete');
});

Deno.test('planDisconnect: deleting an archived Item is local only — its token is gone', () => {
  assertEquals(planDisconnect('archived', 'delete'), 'delete_local');
});

Deno.test('planDisconnect: archiving an archived Item does nothing', () => {
  assertEquals(planDisconnect('archived', 'archive'), 'noop');
});

Deno.test('planDisconnect: an unknown status throws', () => {
  // The check constraint makes this unreachable; failing loudly is right.
  assertThrows(() => planDisconnect('disconnected', 'delete'));
});

Deno.test('isItemGone: ITEM_NOT_FOUND means the Item is already removed', () => {
  assertEquals(isItemGone(plaidError('ITEM_NOT_FOUND')), true);
});

Deno.test('isItemGone: any other Plaid error is a failure', () => {
  assertEquals(isItemGone(plaidError('ITEM_LOGIN_REQUIRED')), false);
  assertEquals(isItemGone(plaidError('INVALID_ACCESS_TOKEN')), false);
});

Deno.test('isItemGone: a network error with no response is a failure', () => {
  // Deleting the token after a transient error would leak a billed Item forever.
  assertEquals(isItemGone(new Error('connection reset')), false);
  assertEquals(isItemGone(undefined), false);
});

const live = [
  { name: 'Checking', mask: '1000' },
  { name: 'Credit card', mask: '2000' },
];

Deno.test('isDuplicateLink: same name and mask matches', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Checking', mask: '1000' }]), true);
});

Deno.test('isDuplicateLink: same mask with a different name is a different account', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Savings', mask: '1000' }]), false);
});

Deno.test('isDuplicateLink: different masks do not match', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Checking', mask: '0000' }]), false);
});

Deno.test('isDuplicateLink: folds case and surrounding space', () => {
  assertEquals(isDuplicateLink(live, [{ name: '  CHECKING ', mask: ' 1000' }]), true);
});

Deno.test('isDuplicateLink: no incoming masks → the same institution alone counts', () => {
  // Plaid's fallback: same institution, same user.
  assertEquals(isDuplicateLink(live, [{ name: 'Checking' }, { name: 'Other', mask: '' }]), true);
  assertEquals(isDuplicateLink(live, []), true);
});

Deno.test('isDuplicateLink: no live Item at the institution never blocks', () => {
  assertEquals(isDuplicateLink([], [{ name: 'Checking', mask: '1000' }]), false);
  assertEquals(isDuplicateLink([], []), false);
});
