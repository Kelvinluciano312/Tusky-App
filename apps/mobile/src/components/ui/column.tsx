import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { Layout } from '@/constants/theme';

/**
 * A centred column no wider than `Layout.maxContent` (Phase 16g). Wrap what a
 * screen shows outside a ScrollView (a fixed header, a card); inside a
 * ScrollView or list, spread `Layout.column` into `contentContainerStyle`.
 */
export function Column({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  return <View style={[Layout.column, style]}>{children}</View>;
}
