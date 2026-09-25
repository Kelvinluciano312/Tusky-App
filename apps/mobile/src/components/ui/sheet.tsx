import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Shifts the sheet above the keyboard on Android — a Modal is its own
      window, so the activity's resize-for-keyboard never reaches it. */
  avoidKeyboard?: boolean;
  style?: ViewStyle;
  children: ReactNode;
};

const OPEN_DURATION = 280;
const CLOSE_DURATION = 220;
const OFFSCREEN = 600;

/**
 * A bottom sheet built from `animationType="none"` plus our own driver, so the
 * backdrop and the panel animate independently: the dim fades uniformly over
 * the whole screen while the panel slides, instead of RN's built-in "slide"
 * moving the dim and the panel together as one block (which reads as the
 * darkening itself sliding in). The sheet stays mounted through the close
 * animation — `visible` on the Modal flips off only once it finishes.
 */
export function Sheet({ visible, onClose, avoidKeyboard, style, children }: SheetProps) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // A plain module-level Animated.Value would be shared across every Sheet
  // instance; useState's lazy initializer keeps it stable per-instance
  // without the render-time ref access `useRef().current` would need.
  const [progress] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);

  // Mount synchronously on open, in the render body rather than an effect —
  // React's documented pattern for adjusting state to a prop change — so the
  // Modal (and the open animation effect below) never miss the first frame.
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setMounted(true);
  }

  useEffect(() => {
    if (visible) {
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={avoidKeyboard ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: Radius.xl,
              borderTopRightRadius: Radius.xl,
              paddingBottom: insets.bottom + Spacing.md,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }) },
              ],
            },
            style,
          ]}>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
