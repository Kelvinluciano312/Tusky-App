import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NAME_MAX, validatePersonName } from '@/lib/profile';

type Props = {
  visible: boolean;
  current: string;
  isSaving?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
};

/** Change your display name: what Home greets you by and what your herd sees. */
export function NameSheet({ visible, current, isSaving, onSave, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // Seeded once per mount; the screen keys this sheet by visibility.
  const [value, setValue] = useState(current);
  const valid = validatePersonName(value);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Padding on Android too: a Modal is its own window (see rename-sheet.tsx). */}
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
          <AppText variant="title">Your name</AppText>
          <TextField
            label="Name"
            value={value}
            onChangeText={setValue}
            maxLength={NAME_MAX}
            autoCapitalize="words"
            // Editing, not filling a form: Android autofill would swap in the device owner's name.
            autoComplete="off"
            importantForAutofill="no"
            autoFocus
          />
          <AppText variant="caption" tone="dim">
            Shown on Home, and to the people you share Tusky with.
          </AppText>
          <Button
            title="Save"
            disabled={!valid || valid === current}
            loading={isSaving}
            onPress={() => valid && onSave(valid)}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
