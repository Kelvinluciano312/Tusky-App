export const ANDROID_PACKAGE = 'com.ouroborosstudios.tusky';

/**
 * Link's native OAuth return path differs by platform: iOS needs a registered
 * universal link (`redirect_uri`), Android the package name. Old clients send no
 * platform and are Android. On iOS with no URI configured, send neither: banks
 * without OAuth still link.
 */
export function linkPlatformFields(
  platform: unknown,
  iosRedirectUri: string,
): { redirect_uri: string } | { android_package_name: string } | Record<string, never> {
  if (platform === 'ios') return iosRedirectUri ? { redirect_uri: iosRedirectUri } : {};
  return { android_package_name: ANDROID_PACKAGE };
}
