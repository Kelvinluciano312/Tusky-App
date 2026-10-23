import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasswordChecklist } from '@/components/password-checklist';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { Layout, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PASSWORD_MIN, passwordOk, passwordsMatch } from '@/lib/password';
import { passwordUpdateMessage } from '@/lib/recovery';
import { setRecovering, useRecovering } from '@/lib/recovery-session';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { problem, ready } = useRecovering();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const email = session?.user.email ?? '';

  const showForm = ready && !!session && !problem;

  const leave = async () => {
    // Cancel from the form drops the recovery session. A failed link does not
    // sign out whoever was already signed in.
    if (showForm) await supabase.auth.signOut();
    setRecovering(false);
  };

  const save = async () => {
    setError(null);
    if (!email) {
      setError('This reset link has expired. Request a new one from the sign-in screen.');
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError(passwordUpdateMessage(updateError));
      return;
    }
    // A recovery session is not a password session. Two-step sign-in refuses
    // anything else, so sign in again with the password that was just saved.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      await supabase.auth.signOut();
      setRecovering(false);
      dialog.alert('Password saved', 'Sign in with your new password.');
      return;
    }
    setRecovering(false);
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
          <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>Set a new password</AppText>
          <AppText tone="dim" style={{ marginTop: Spacing.xs }}>
            {email ? `For ${email}` : 'Opening your reset link…'}
          </AppText>
        </View>

        {!showForm ? (
          <View style={{ gap: Spacing.md }}>
            <AppText tone={problem ? 'negative' : 'dim'}>
              {problem ?? 'Checking the reset link…'}
            </AppText>
            <Button title="Back to sign in" variant="secondary" onPress={() => void leave()} />
          </View>
        ) : (
          <View style={{ gap: Spacing.md }}>
            {problem ? (
              <AppText variant="caption" tone="negative">
                {problem}
              </AppText>
            ) : null}
            <TextField
              label="New password"
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
            {error ? (
              <AppText variant="caption" tone="negative">
                {error}
              </AppText>
            ) : null}
            <Button
              title="Save password"
              onPress={() => void save()}
              loading={submitting}
              disabled={!passwordOk(password, email) || !passwordsMatch(password, confirm)}
            />
            <Button title="Cancel" variant="ghost" onPress={() => void leave()} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
