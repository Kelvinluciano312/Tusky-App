import { type ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { screenKeyboardPadding } from '@/lib/sheet-keyboard';

/**
 * A full screen (not a modal) whose bottom edge sits on the keyboard.
 * Sheets use `Sheet` instead: a modal does not resize with the window, and its
 * keyboard overlap is the event height alone.
 */
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const overlap = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const paddingBottom = screenKeyboardPadding(overlap, insets.bottom, 0, Platform.OS);
  return <View style={[{ flex: 1 }, style, paddingBottom > 0 ? { paddingBottom } : null]}>{children}</View>;
}
