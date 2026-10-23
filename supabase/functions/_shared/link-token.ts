// Which native id /link/token/create gets. Plaid wants exactly one:
// android_package_name on Android, redirect_uri on iOS. Sending both, or the
// Android package on an iOS token, breaks OAuth. A missing platform keeps the
// Android package, which is what every token used before the phone named itself.

export const PLAID_ANDROID_PACKAGE = 'com.ouroborosstudios.tusky';
export const PLAID_IOS_REDIRECT_URI = 'https://studiosouroboros.com/tusky/plaid-oauth';

export function linkTokenClientConfig(
  platform: unknown,
): { android_package_name: string } | { redirect_uri: string } {
  if (platform === 'ios') return { redirect_uri: PLAID_IOS_REDIRECT_URI };
  return { android_package_name: PLAID_ANDROID_PACKAGE };
}
