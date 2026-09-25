import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { validateDisplayName } from '@/lib/merchants';

type Props = {
  visible: boolean;
  /** The name shown today: the current rename, or Plaid's. */
  current: string;
  /** Plaid's name, which "Use the bank's name" returns to. */
  original: string;
  /** Whether a rename exists to remove. */
  renamed: boolean;
  isSaving?: boolean;
  onSave: (name: string) => void;
  onReset: () => void;
  onClose: () => void;
};

/** Rename a merchant everywhere it shows. Android has no Alert.prompt, so a sheet. */
export function RenameSheet({ visible, current, original, renamed, isSaving, onSave, onReset, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // Seeded once per mount; the screen keys this sheet by merchant.
  const [value, setValue] = useState(current);
  const valid = validateDisplayName(value);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Padding on Android too: a Modal is its own window, which the activity's
          resize-for-keyboard never reaches, so the keyboard would cover the sheet. */}
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
          <AppText variant="title">Rename merchant</AppText>
          <TextField label="Name" value={value} onChangeText={setValue} maxLength={60} placeholder={original} />
          <AppText variant="caption" tone="dim">
            Shows everywhere this merchant appears: transactions, Recurring and Upcoming.
          </AppText>
          <Button
            title="Save"
            disabled={!valid || valid === current}
            loading={isSaving}
            onPress={() => valid && onSave(valid)}
          />
          {renamed ? <Button title={`Use the bank's name (${original})`} variant="ghost" onPress={onReset} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
