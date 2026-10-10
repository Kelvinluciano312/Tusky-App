import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodeEntry } from '@/components/code-entry';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Layout, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { FirstRunState } from '@/lib/first-run';
import { confirmLoginCode, sendLoginCode } from '@/lib/login-code';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { RESEND_SECONDS } from '@/lib/two-factor';

// When a code last went out, per address, kept outside the component: the
// screen can remount (a re-render of the root gate, StrictMode) and must not
// mail a second code, nor restart the countdown.
const lastSent = new Map<string, number>();

/**
 * The second step of sign-in (Phase 16e), shown by the root gate to a user who
 * turned on two-step sign-in and whose session the server has not verified.
 * Verifying marks this session on the server (it is not replaced); the
 * first-run query is then fetched again, the gate re-renders and the app opens.
 * "Sign out" is the way back.
 */
export default function VerifyScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const email = session?.user.email ?? '';
  // Decided once, on first render: reuse a code sent in the last minute, else send one.
  const [initial] = useState(() => {
    const now = Date.now();
    const previous = lastSent.get(email);
    const fresh = previous !== undefined && now - previous < RESEND_SECONDS * 1000;
    return { at: fresh ? previous : now, send: !fresh };
  });
  const [sentAt, setSentAt] = useState<number | null>(initial.at);
  const [sendError, setSendError] = useState<string | null>(null);
  const started = useRef(false);
  // The server accepted the code: a retry after a failed refetch only refetches.
  const confirmed = useRef(false);

  useEffect(() => {
    // The ref keeps StrictMode's second run from mailing two codes.
    if (started.current || !email || !initial.send) return;
    started.current = true;
    lastSent.set(email, initial.at);
    void sendLoginCode(email).then((failure) => {
      setSendError(failure?.message ?? null);
      // A failed send must not hold the resend button behind a countdown, nor block a remount's retry.
      if (failure && !failure.sent) {
        setSentAt(null);
        lastSent.delete(email);
      }
    });
  }, [email, initial]);

  const resend = async () => {
    const at = Date.now();
    lastSent.set(email, at);
    setSentAt(at);
    const failure = await sendLoginCode(email);
    setSendError(failure?.message ?? null);
    if (failure && !failure.sent) {
      setSentAt(null);
      lastSent.delete(email);
    }
  };

  const submit = async (code: string) => {
    if (!confirmed.current) {
      const failure = await confirmLoginCode(code);
      if (failure) return failure;
      confirmed.current = true;
    }
    // The unverified session saw nothing; everything is fetched again, the gate's own answer included.
    await queryClient.invalidateQueries();
    // If the gate's own read failed, the screen would stay on `verify` with the field busy for good.
    const state = queryClient.getQueryData<FirstRunState>(['first-run', session?.user.id]);
    if (state?.secondStepDone !== true) {
      return 'Your code was accepted, but we could not open Tusky. Check your connection and try again.';
    }
    lastSent.delete(email);
    return null;
  };

  const signOut = async () => {
    lastSent.delete(email);
    await supabase.auth.signOut();
    // The next person to sign in on this device must never see this one's cached data.
    queryClient.clear();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <ScrollView
        contentContainerStyle={{
          ...Layout.column,
          flexGrow: 1,
          justifyContent: 'center',
          padding: Spacing.lg,
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.md,
        }}
        keyboardShouldPersistTaps="handled">
        <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>Check your email</AppText>
        <AppText tone="dim">
          Two-step sign-in is on. We sent a code to {email}. Enter it to open Tusky.
        </AppText>
        <CodeEntry sentAt={sentAt} sendError={sendError} onSubmit={submit} onResend={() => void resend()} />
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
