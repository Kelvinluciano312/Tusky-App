import { Link, router } from 'expo-router';
import { Check, LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasswordChecklist } from '@/components/password-checklist';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/constants/legal';
import { Layout, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PASSWORD_MIN, passwordOk, passwordsMatch } from '@/lib/password';
import { NAME_MAX, validatePersonName } from '@/lib/profile';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const validName = validatePersonName(name);

  const signUp = async () => {
    setError(null);
    setSubmitting(true);
    // The signup trigger turns display_name into the profile, and records the
    // terms version as accepted (Phase 15c): with email confirmation there is
    // no session yet to record it from here.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: validName, terms_version: TERMS_VERSION } },
    });
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
          <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>Create your account</AppText>
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
              label="Your name"
              value={name}
              onChangeText={setName}
              maxLength={NAME_MAX}
              autoCapitalize="words"
              autoComplete="name"
              placeholder="What should Tusky call you?"
            />
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
              password
              autoComplete="new-password"
              placeholder={`At least ${PASSWORD_MIN} characters`}
            />
            <TextField
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              password
              autoComplete="new-password"
              placeholder="Type it again"
            />
            <PasswordChecklist password={password} email={email} confirm={confirm} />

            <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
                hitSlop={8}
                onPress={() => setAgreed((a) => !a)}
                style={{
                  width: 22,
                  height: 22,
                  marginTop: 1,
                  borderRadius: Radius.sm,
                  borderWidth: 1.5,
                  borderColor: agreed ? colors.brand : colors.border,
                  backgroundColor: agreed ? colors.brand : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {agreed ? <Check size={14} color={colors.onBrand} strokeWidth={3} /> : null}
              </Pressable>
              <AppText tone="dim" style={{ flex: 1 }}>
                I agree to the{' '}
                <AppText tone="brand" onPress={() => void Linking.openURL(TERMS_URL)}>
                  Terms of Service
                </AppText>{' '}
                and the{' '}
                <AppText tone="brand" onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </AppText>
                .
              </AppText>
            </View>

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
              disabled={!isSupabaseConfigured || !validName || !email || !passwordOk(password, email) || !passwordsMatch(password, confirm) || !agreed}
            />

            <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
              <LockKeyhole size={16} color={colors.textDim} strokeWidth={1.75} style={{ marginTop: 2 }} />
              <AppText variant="caption" tone="dim" style={{ flex: 1 }}>
                You connect banks through Plaid, so Tusky never sees your bank login, and it can only read
                your accounts, never move money. Your sign-in is kept in your phone&apos;s secure storage.
              </AppText>
            </View>

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
