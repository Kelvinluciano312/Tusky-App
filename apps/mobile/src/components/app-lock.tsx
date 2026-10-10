import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Image, Modal, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { dialog } from '@/components/ui/dialog';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shouldLockOnResume } from '@/lib/app-lock';
import { promptUnlock, useLockMethodLabel } from '@/lib/app-lock-auth';
import { readAppLock, writeAppLock } from '@/lib/app-lock-store';
import { usePrivacyShield } from '@/lib/privacy-shield';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type AppLockState = {
  /** The device's App lock preference (never synced to the account). */
  enabled: boolean;
  setEnabled: (on: boolean) => Promise<void>;
};

const AppLockContext = createContext<AppLockState>({ enabled: false, setEnabled: async () => {} });

export function useAppLock() {
  return useContext(AppLockContext);
}

/**
 * Phase 17 App lock. With it on, a signed-in Tusky opens locked and locks again
 * after a minute away; the system prompt (Face ID, Touch ID, fingerprint, or the
 * phone's passcode) unlocks it. The cover is a full-screen Modal so it sits above
 * sheets, dialogs and Plaid Link, whatever is open underneath.
 */
export function AppLockProvider({ children }: PropsWithChildren) {
  const { session, isLoading } = useSession();
  const userId = session?.user.id ?? null;
  const [enabled, setEnabledState] = useState(readAppLock);
  // The very first frame is already locked when the preference is on: nothing shows before the prompt.
  const [locked, setLocked] = useState(enabled);
  usePrivacyShield(enabled);

  // Who was signed in once the stored session was restored (undefined until then). Nobody is locked
  // out of a signed-out app, and someone who has just signed in has just proven who they are; only
  // a session restored at launch starts locked.
  const [seenUser, setSeenUser] = useState<string | null | undefined>(undefined);
  if (!isLoading && seenUser !== userId) {
    setSeenUser(userId);
    if (userId === null || seenUser === null) setLocked(false);
  }

  const awaySince = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || userId === null) {
      awaySince.current = null;
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (shouldLockOnResume(true, awaySince.current, Date.now())) setLocked(true);
        awaySince.current = null;
      } else if (awaySince.current === null) {
        awaySince.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [enabled, userId]);

  const setEnabled = async (on: boolean) => {
    await writeAppLock(on);
    setEnabledState(on);
  };

  const visible = enabled && locked && userId !== null;

  return (
    <AppLockContext.Provider value={{ enabled, setEnabled }}>
      {children}
      {visible ? <LockScreen onUnlocked={() => setLocked(false)} /> : null}
    </AppLockContext.Provider>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const colors = useTheme();
  const queryClient = useQueryClient();
  const label = useLockMethodLabel();
  const [failure, setFailure] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  const unlock = async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setFailure(null);
    const result = await promptUnlock('Unlock Tusky');
    busy.current = false;
    setChecking(false);
    if (result.ok) onUnlocked();
    else setFailure(result.message);
  };

  // The prompt opens by itself once per lock; the button is for asking again.
  const prompted = useRef(false);
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    void unlock();
  });

  const confirmSignOut = () =>
    dialog.alert('Sign out of Tusky?', 'You can sign in again with your password or Apple.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void supabase.auth.signOut().then(() => queryClient.clear());
        },
      },
    ]);

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
        }}>
        <View style={{ width: '100%', maxWidth: 420, alignItems: 'center', gap: Spacing.md }}>
          <Image
            source={require('@/assets/images/tusky-logo.png')}
            style={{ width: 88, height: 88 }}
            resizeMode="contain"
          />
          <AppText style={{ fontFamily: Type.display, fontSize: 28, lineHeight: 36 }}>Tusky is locked</AppText>
          <AppText tone="dim" style={{ textAlign: 'center' }}>
            Your money stays hidden until you unlock it.
          </AppText>
          <View style={{ width: '100%', gap: Spacing.sm, marginTop: Spacing.md }}>
            <Button title={`Unlock with ${label}`} loading={checking} onPress={() => void unlock()} />
            {failure ? (
              <AppText variant="caption" tone="negative" style={{ textAlign: 'center' }}>
                {failure}
              </AppText>
            ) : null}
            <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
