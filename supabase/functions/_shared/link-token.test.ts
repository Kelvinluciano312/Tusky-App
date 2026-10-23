import { assertEquals } from 'jsr:@std/assert';

import { PLAID_ANDROID_PACKAGE, PLAID_IOS_REDIRECT_URI, linkTokenClientConfig } from './link-token.ts';

Deno.test('iOS link tokens carry the OAuth redirect and not the Android package', () => {
  assertEquals(linkTokenClientConfig('ios'), { redirect_uri: PLAID_IOS_REDIRECT_URI });
});

Deno.test('Android, and a phone that did not name itself, keep the package name', () => {
  assertEquals(linkTokenClientConfig('android'), { android_package_name: PLAID_ANDROID_PACKAGE });
  assertEquals(linkTokenClientConfig(undefined), { android_package_name: PLAID_ANDROID_PACKAGE });
  assertEquals(linkTokenClientConfig('web'), { android_package_name: PLAID_ANDROID_PACKAGE });
});
