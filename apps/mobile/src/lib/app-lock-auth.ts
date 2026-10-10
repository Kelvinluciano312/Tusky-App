import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { lockMethodLabel, unlockFailureMessage } from '@/lib/app-lock';

export type UnlockResult = { ok: true } | { ok: false; message: string | null };

/**
 * One system prompt: Face ID / Touch ID / fingerprint, falling back to the
 * phone's passcode. `message` is null when the person simply cancelled.
 */
export async function promptUnlock(promptMessage: string): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    if (result.success) return { ok: true };
    return { ok: false, message: unlockFailureMessage(result.error) };
  } catch {
    return { ok: false, message: unlockFailureMessage('unknown') };
  }
}

/** Whether this phone has any biometric or passcode that could answer a lock prompt. */
export async function canLockHere(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** The unlock method's name for this phone: "Face ID", "Touch ID", "fingerprint", ... */
export function useLockMethodLabel(): string {
  const [label, setLabel] = useState('passcode');
  useEffect(() => {
    let live = true;
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (live) setLabel(lockMethodLabel(types, Platform.OS));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return label;
}
