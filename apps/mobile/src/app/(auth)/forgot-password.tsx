import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodeEntry } from '@/components/code-entry';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Layout, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PASSWORD_RESET_REDIRECT, recoveryExchangeMessage, resetRequestMessage } from '@/lib/recovery';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const send = async () => {
    const address = email.trim();
    setError(null);
    if (!address.includes('@')) {
      setError('Enter the email you use for Tusky.');
      return;
    }
    setSubmitting(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: PASSWORD_RESET_REDIRECT,
    });
    setSubmitting(false);
    const message = resetRequestMessage(sendError);
    if (message) {
      setError(message);
      return;
    }
    setSentAt(Date.now());
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
        }}
        keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: Spacing.xl }}>
          <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>Reset your password</AppText>
          <AppText tone="dim" style={{ marginTop: Spacing.xs }}>
            We email a link that opens Tusky so you can choose a new one.
          </AppText>
        </View>

        {sentAt === null ? (
          <View style={{ gap: Spacing.md }}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            {error ? (
              <AppText variant="caption" tone="negative">
                {error}
              </AppText>
            ) : null}
            <Button
              title="Send reset email"
              onPress={() => void send()}
              loading={submitting}
              disabled={!isSupabaseConfigured || !email.trim()}
            />
            <Button title="Back to sign in" variant="ghost" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={{ gap: Spacing.md }}>
            <AppText variant="title">Check your email</AppText>
            <AppText tone="dim">
              We sent a reset link to {email.trim()}. Open it on this phone and Tusky will ask for a new password. If the email shows a code instead, enter it here.
            </AppText>
            <CodeEntry
              sentAt={sentAt}
              sendError={error}
              submitTitle="Continue"
              onResend={() => void send()}
              onSubmit={async (code) => {
                const { error: codeError } = await supabase.auth.verifyOtp({
                  email: email.trim(),
                  token: code,
                  type: 'recovery',
                });
                return codeError
                  ? recoveryExchangeMessage(codeError) ?? 'That code is not right or has expired.'
                  : null;
              }}
            />
            <Button title="Use a different email" variant="ghost" onPress={() => { setSentAt(null); setError(null); }} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
