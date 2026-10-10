import { useQueryClient } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { saveAppleName, signInWithApple, useAppleSignInAvailable } from '@/lib/apple-auth';

// Matches components/ui/button.tsx: 14 + 14 padding around a 19-point label line.
const BUTTON_HEIGHT = 47;

/**
 * "Sign in with Apple" under the primary button of the sign-in and sign-up
 * screens. It renders only on an iPhone or iPad, so Android's screens are untouched.
 * The terms checkbox does not gate it: the accept-terms screen asks Apple users next.
 */
export function AppleSignIn({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const colors = useTheme();
  const scheme = useColorScheme();
  const queryClient = useQueryClient();
  const available = useAppleSignInAvailable();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) return null;

  const onPress = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithApple();
      if (result.status === 'signed_in' && result.name) {
        await saveAppleName(result.userId, result.name).catch(() => {});
        await queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in with Apple failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: Spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <AppText variant="caption" tone="dim">
          or
        </AppText>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          mode === 'sign-in'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
            : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
        }
        buttonStyle={
          scheme === 'light'
            ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
        }
        cornerRadius={Radius.md}
        style={{ width: '100%', height: BUTTON_HEIGHT, opacity: busy ? 0.5 : 1 }}
        onPress={() => void onPress()}
      />
      {error && (
        <AppText variant="caption" tone="negative">
          {error}
        </AppText>
      )}
    </View>
  );
}
