import * as SecureStore from 'expo-secure-store';

/**
 * App lock is a per-device choice: it protects what this phone shows, so it is
 * kept in the keystore of this phone and never synced to the account. It is
 * read synchronously so the very first frame already knows whether to lock.
 */
const KEY = 'tusky.appLock';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function readAppLock(): boolean {
  try {
    return SecureStore.getItem(KEY, OPTIONS) === 'on';
  } catch {
    // A keystore that cannot be read must not lock a person out of their own app.
    return false;
  }
}

export async function writeAppLock(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(KEY, 'on', OPTIONS);
  else await SecureStore.deleteItemAsync(KEY, OPTIONS);
}
