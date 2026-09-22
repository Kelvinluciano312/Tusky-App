import { View, type ViewProps, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's surface panel. Extracted once Budgets and Reports would have made a
 * fourth and fifth copy of the same inline object.
 */
export function Card({ style, ...rest }: ViewProps) {
  const colors = useTheme();

  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.lg,
  };

  return <View {...rest} style={[base, style]} />;
}
