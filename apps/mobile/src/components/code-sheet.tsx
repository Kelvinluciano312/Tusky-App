import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodeEntry } from '@/components/code-entry';
import { AppText } from '@/components/ui/app-text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  visible: boolean;
  title: string;
  /** What this code is for, above the field. */
  message: string;
  sentAt: number | null;
  sendError?: string | null;
  onSubmit: (code: string) => Promise<string | null>;
  onResend: () => void;
  onClose: () => void;
};

/**
 * Ask for an emailed code in a bottom sheet (Phase 16e), for switching two-step
 * sign-in on or off. The screen keys this sheet by visibility, so the field
 * starts empty on each opening.
 */
export function CodeSheet({ visible, title, message, sentAt, sendError, onSubmit, onResend, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Padding on Android too: a Modal is its own window. */}
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        behavior="padding">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={{
            ...Layout.sheet,
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.xl,
            borderTopRightRadius: Radius.xl,
            paddingTop: Spacing.lg,
            paddingHorizontal: Spacing.md,
            paddingBottom: insets.bottom + Spacing.md,
            gap: Spacing.md,
          }}>
          <AppText variant="title">{title}</AppText>
          <AppText tone="dim">{message}</AppText>
          <CodeEntry sentAt={sentAt} sendError={sendError} onSubmit={onSubmit} onResend={onResend} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
