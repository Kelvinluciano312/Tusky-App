import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelButton,
  dismissAction,
  dismissHead,
  enqueue,
  layoutFor,
  lookFor,
  normalizeButtons,
  type DialogButton,
  type DialogOptions,
  type DialogRequest,
} from '@/lib/dialog-queue';

/**
 * App-styled dialogs (Phase 16f). `dialog.alert` has the signature and
 * semantics of React Native's system alert, so it can be called from anywhere,
 * including a mutation callback outside React. `<DialogHost />` renders the
 * queue once, at the root. Never import `Alert` from react-native (ESLint says so).
 */

const CARD_MAX_WIDTH = 420;
const MESSAGE_MAX_HEIGHT = 280;

let queue: DialogRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: DialogRequest[]) {
  queue = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => queue;

export const dialog = {
  alert(title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) {
    emit(
      enqueue(queue, {
        id: nextId++,
        title,
        message,
        buttons: normalizeButtons(buttons),
        cancelable: options?.cancelable,
      }),
    );
  },
};

/** Close the dialog first, then run the button, so an onPress that raises another dialog queues cleanly. */
function resolve(request: DialogRequest, button?: DialogButton) {
  if (queue[0]?.id !== request.id) return; // a double tap must not close the next dialog
  emit(dismissHead(queue));
  button?.onPress?.();
}

export function DialogHost() {
  const requests = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const current = requests[0];
  if (!current) return null;
  return <DialogCard key={current.id} request={current} />;
}

function DialogCard({ request }: { request: DialogRequest }) {
  const colors = useTheme();
  const { title, message, buttons } = request;
  const layout = layoutFor(buttons);
  // The back button and a scrim tap stand for the cancel button; without one they only dismiss.
  const action = dismissAction(request);
  const dismiss = () => {
    if (action !== 'none') resolve(request, cancelButton(buttons));
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.center}>
        <Pressable
          accessible={false}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
          onPress={dismiss}
        />
        <View
          role="alertdialog"
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={{
            width: '100%',
            maxWidth: CARD_MAX_WIDTH,
            backgroundColor: colors.surface,
            borderRadius: Radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}>
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          {message ? (
            <ScrollView style={{ flexGrow: 0, maxHeight: MESSAGE_MAX_HEIGHT }}>
              <AppText tone="dim">{message}</AppText>
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: layout, gap: Spacing.sm, marginTop: Spacing.xs }}>
            {buttons.map((b, i) => (
              <Button
                key={i}
                title={b.text ?? 'OK'}
                variant={lookFor(b, buttons)}
                accessibilityLabel={b.text}
                onPress={() => resolve(request, b)}
                style={layout === 'row' ? { flex: 1 } : undefined}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
});
