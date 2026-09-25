import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NOTE_MAX, normalizeNote } from '@/lib/review';

type Props = {
  visible: boolean;
  current: string | null;
  isSaving?: boolean;
  /** null clears the memo. */
  onSave: (notes: string | null) => void;
  onClose: () => void;
};

/** Write or clear a transaction's memo. A sheet, not an inline field, so the keyboard never fights a paged list. */
export function NoteSheet({ visible, current, isSaving, onSave, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // Seeded once per mount; callers key this sheet by transaction.
  const [value, setValue] = useState(current ?? '');
  const next = normalizeNote(value);

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
          <AppText variant="title">Memo</AppText>
          <TextField
            label="What was this?"
            value={value}
            onChangeText={setValue}
            maxLength={NOTE_MAX}
            placeholder="Dinner with Ana, office chair…"
            multiline
            autoFocus
            style={{ minHeight: 88, textAlignVertical: 'top' }}
          />
          <Button title="Save" disabled={next === current} loading={isSaving} onPress={() => onSave(next)} />
          {current ? <Button title="Remove memo" variant="ghost" onPress={() => onSave(null)} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
