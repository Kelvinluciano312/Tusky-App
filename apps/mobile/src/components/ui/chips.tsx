import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Chip<T> = { value: T; label: string };

/** A single choice among a few short options, e.g. who paid: each member, or Joint. */
export function Chips<T>({
  options,
  selected,
  onSelect,
  accessibilityLabel,
}: {
  options: Chip<T>[];
  selected: T;
  onSelect: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const colors = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs + 2 }}>
      {options.map((option) => {
        const on = option.value === selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
            onPress={() => !on && onSelect(option.value)}
            style={({ pressed }) => ({
              paddingVertical: Spacing.xs + 2,
              paddingHorizontal: Spacing.md - 2,
              borderRadius: Radius.full,
              borderWidth: 1,
              borderColor: on ? colors.brand : colors.border,
              backgroundColor: on ? colors.brand : pressed ? colors.elevated : 'transparent',
            })}>
            <AppText variant="label" style={{ color: on ? colors.onBrand : colors.text }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
