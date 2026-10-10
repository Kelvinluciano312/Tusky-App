import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** 0 is no blur, 1 the most the module offers: enough that balances cannot be read. */
const SWITCHER_BLUR = 1;

/**
 * What the phone's task switcher and screenshots can see (Phase 17).
 *
 * iOS always blurs Tusky in the app switcher. Android shows a blank card in
 * Recents and blocks screenshots and screen recording (FLAG_SECURE) while App
 * lock is on. Neither can fail the app: a platform that cannot do it just
 * shows what it showed before.
 */
export function usePrivacyShield(appLockOn: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    ScreenCapture.enableAppSwitcherProtectionAsync(SWITCHER_BLUR).catch(() => {});
    return () => {
      ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !appLockOn) return;
    ScreenCapture.preventScreenCaptureAsync('app-lock').catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync('app-lock').catch(() => {});
    };
  }, [appLockOn]);
}
