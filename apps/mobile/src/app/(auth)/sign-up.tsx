import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const signUp = async () => {
    setError(null);
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // With email confirmation enabled there's no session yet — tell them to check email.
    if (!data.session) {
      setAwaitingConfirmation(true);
    }
    // With confirmation disabled, the session listener signs them straight in.
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: Spacing.lg,
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: Spacing.xl }}>
          <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>
            Create your account
          </AppText>
          <AppText tone="dim" style={{ marginTop: Spacing.xs }}>
            Tusky keeps your accounts, spending, and budgets in one place.
          </AppText>
        </View>

        {awaitingConfirmation ? (
          <View style={{ gap: Spacing.md }}>
            <AppText variant="title">Check your email</AppText>
            <AppText tone="dim">
              We sent a confirmation link to {email.trim()}. Open it, then come back and sign in.
            </AppText>
            <Button title="Go to sign in" onPress={() => router.back()} />
          </View>
        ) : (
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
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />

            {error && (
              <AppText variant="caption" tone="negative">
                {error}
              </AppText>
            )}
            {!isSupabaseConfigured && (
              <AppText variant="caption" tone="dim">
                Supabase isn&apos;t configured yet. Add EXPO_PUBLIC_SUPABASE_URL and
                EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart the dev server.
              </AppText>
            )}

            <Button
              title="Create account"
              onPress={signUp}
              loading={submitting}
              disabled={!isSupabaseConfigured || !email || password.length < 6}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.sm, gap: Spacing.xs }}>
              <AppText tone="dim">Already have an account?</AppText>
              <Link href="/sign-in">
                <AppText tone="brand" variant="label">
                  Sign in
                </AppText>
              </Link>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
