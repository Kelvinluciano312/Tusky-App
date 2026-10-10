import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { manageSubscriptionsUrl } from '@/lib/purchases';

/** What the person must type, exactly (case-sensitive). */
export const DELETE_WORD = 'DELETE';

type Props = {
  visible: boolean;
  /** From `deleteWarning`: set when a store subscription outlives the account. */
  warning: string | null;
  /** What proves it is them: the password, or (Apple-only accounts on iOS) a fresh Sign in with Apple. */
  proof: 'password' | 'apple';
  isDeleting?: boolean;
  error?: string | null;
  /** The typed password, or null when the screen confirms with Apple itself. */
  onDelete: (password: string | null) => void;
  onClose: () => void;
};

/**
 * Deleting the account asks for more than a tap (Phase 16d): what is lost, the
 * subscription warning, the word DELETE and the password. The server checks the
 * proof before it touches anything, so a wrong one shows up here as `error`.
 * An Apple-only account has no password, so Apple asks next instead (Phase 17).
 */
export function DeleteAccountSheet({ visible, warning, proof, isDeleting, error, onDelete, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // Empty on each opening; the screen keys this sheet by visibility.
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');

  const close = () => {
    if (!isDeleting) onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      {/* Padding on Android too: a Modal is its own window. */}
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        behavior="padding">
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View
          style={{
            ...Layout.sheet,
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.xl,
            borderTopRightRadius: Radius.xl,
            maxHeight: '90%',
          }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingTop: Spacing.lg,
              paddingHorizontal: Spacing.md,
              paddingBottom: insets.bottom + Spacing.md,
              gap: Spacing.md,
            }}>
            <AppText variant="title">Delete your account?</AppText>
            <AppText tone="dim">
              Tusky disconnects your banks and deletes everything you have tracked: your accounts,
              transactions, budgets, rules and settings. If you share a herd, it keeps what belongs to
              the herd. This cannot be undone.
            </AppText>

            {warning ? (
              <View
                style={{
                  gap: Spacing.xs,
                  padding: Spacing.sm,
                  borderRadius: Radius.md,
                  borderWidth: 1,
                  borderColor: colors.negative,
                }}>
                <AppText variant="label" tone="negative">
                  Cancel your subscription first
                </AppText>
                <AppText variant="caption">{warning}</AppText>
                <Pressable
                  accessibilityRole="link"
                  onPress={async () => Linking.openURL(await manageSubscriptionsUrl())}
                  style={{ paddingVertical: Spacing.xs }}>
                  <AppText tone="brand" variant="label">
                    Manage subscription
                  </AppText>
                </Pressable>
              </View>
            ) : null}

            <TextField
              label={`Type ${DELETE_WORD} to confirm`}
              value={word}
              onChangeText={setWord}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={DELETE_WORD}
            />
            {proof === 'password' ? (
              <TextField
                label="Your password"
                value={password}
                onChangeText={setPassword}
                password
                autoComplete="current-password"
                placeholder="Password"
              />
            ) : (
              <AppText variant="caption" tone="dim">
                You&apos;ll confirm with Apple next.
              </AppText>
            )}

            {error ? (
              <AppText variant="caption" tone="negative">
                {error}
              </AppText>
            ) : null}

            <Button
              title="Delete my account"
              loading={isDeleting}
              disabled={word !== DELETE_WORD || (proof === 'password' && password === '')}
              style={{ backgroundColor: colors.negative }}
              onPress={() => onDelete(proof === 'password' ? password : null)}
            />
            <Button title="Cancel" variant="ghost" disabled={isDeleting} onPress={close} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
