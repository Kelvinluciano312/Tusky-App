import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasswordChecklist } from '@/components/password-checklist';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PASSWORD_MIN, passwordOk } from '@/lib/password';

type Props = {
  visible: boolean;
  email: string;
  isSaving?: boolean;
  error?: string | null;
  onSave: (password: string) => void;
  onClose: () => void;
};

/** Choose a new password, under the same rules as sign-up (Phase 15f). */
export function PasswordSheet({ visible, email, isSaving, error, onSave, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // Empty on each opening; the screen keys this sheet by visibility.
  const [value, setValue] = useState('');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Padding on Android too: a Modal is its own window. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.xl,
            borderTopRightRadius: Radius.xl,
            paddingTop: Spacing.lg,
            paddingHorizontal: Spacing.md,
            paddingBottom: insets.bottom + Spacing.md,
            gap: Spacing.md,
          }}>
          <AppText variant="title">New password</AppText>
          <TextField
            label="Password"
            value={value}
            onChangeText={setValue}
            password
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            autoFocus
          />
          <PasswordChecklist password={value} email={email} />
          {error ? (
            <AppText variant="caption" tone="negative">
              {error}
            </AppText>
          ) : null}
          <Button
            title="Save password"
            loading={isSaving}
            disabled={!passwordOk(value, email)}
            onPress={() => onSave(value)}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
