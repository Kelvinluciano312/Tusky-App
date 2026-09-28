import { Link } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { backendLabel } from '@/lib/environment';
import { backend, isSupabaseConfigured, realConfigured, supabase, switchBackend } from '@/lib/supabase';

export default function SignInScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const signIn = async () => {
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
    }
    // On success the session listener flips the root guard and (tabs) takes over.
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
        <View style={{ alignItems: 'center', marginBottom: Spacing.xl }}>
          <Image
            source={require('@/assets/images/tusky-logo.png')}
            style={{ width: 88, height: 88, marginBottom: Spacing.md }}
            resizeMode="contain"
          />
          <AppText style={{ fontFamily: Type.display, fontSize: 40, lineHeight: 48 }}>Tusky</AppText>
          <AppText tone="dim" style={{ marginTop: Spacing.xs }}>
            Money, remembered.
          </AppText>
        </View>

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
            autoComplete="current-password"
            placeholder="Your password"
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
            title="Sign in"
            onPress={signIn}
            loading={submitting}
            disabled={!isSupabaseConfigured || !email || !password}
          />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg, gap: Spacing.xs }}>
          <AppText tone="dim">New to Tusky?</AppText>
          <Link href="/sign-up">
            <AppText tone="brand" variant="label">
              Create an account
            </AppText>
          </Link>
        </View>

        {__DEV__ && realConfigured ? (
          /* Dev builds only. Signed out there is no Settings, so the
             Sandbox / Real data switch lives here too. */
          <Pressable
            onPress={() => switchBackend(backend === 'real' ? 'sandbox' : 'real')}
            style={{ alignSelf: 'center', marginTop: Spacing.lg, padding: Spacing.sm }}>
            <AppText variant="caption" tone="dim">
              {backendLabel(backend)} (dev) · Switch to {backend === 'real' ? 'Sandbox' : 'Real data'}
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
