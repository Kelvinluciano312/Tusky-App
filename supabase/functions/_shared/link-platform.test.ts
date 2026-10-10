import { assertEquals } from 'jsr:@std/assert';

import { ANDROID_PACKAGE, linkPlatformFields } from './link-platform.ts';

const IOS_URI = 'https://studiosouroboros.com/tusky/plaid/oauth';

Deno.test('iOS with a registered redirect URI sends redirect_uri', () => {
  assertEquals(linkPlatformFields('ios', IOS_URI), { redirect_uri: IOS_URI });
});

Deno.test('iOS with no redirect URI configured sends neither field, so non-OAuth banks still link', () => {
  assertEquals(linkPlatformFields('ios', ''), {});
});

Deno.test('Android sends the package name', () => {
  assertEquals(linkPlatformFields('android', IOS_URI), { android_package_name: ANDROID_PACKAGE });
});

Deno.test('an old client sends no platform and is treated as Android', () => {
  assertEquals(linkPlatformFields(undefined, IOS_URI), { android_package_name: ANDROID_PACKAGE });
});

Deno.test('a platform of the wrong type is treated as Android', () => {
  assertEquals(linkPlatformFields(42, IOS_URI), { android_package_name: ANDROID_PACKAGE });
});
