import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Category } from '@/lib/queries';

type Props = {
  category: Category;
  spent: number;
  /** Undefined for a category with no budget set. */
  budget?: number;
  onPress: () => void;
};

export function BudgetRow({ category, spent, budget, onPress }: Props) {
  const colors = useTheme();
  const over = budget !== undefined && spent > budget;
  // Clamped for the bar only: `spent` itself can go negative in a month where
  // refunds outweigh purchases, and the numbers above should say so.
  const fraction =
    budget === undefined || budget === 0
      ? over
        ? 1
        : 0
      : Math.max(0, Math.min(1, spent / budget));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        gap: Spacing.sm,
        paddingVertical: Spacing.sm + 2,
        paddingHorizontal: Spacing.xs,
        borderRadius: Radius.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <CategoryIcon name={category.icon} size={17} color={category.color} />
        </View>

        <AppText variant="label" style={{ flex: 1 }}>
          {category.name}
        </AppText>

        <View style={{ alignItems: 'flex-end' }}>
          <Amount value={spent} size={15} />
          {budget === undefined ? (
            <AppText variant="caption" tone="dim">
              No budget
            </AppText>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <AppText variant="caption" tone="dim">
                of
              </AppText>
              <Amount value={budget} size={12.5} style={{ color: colors.textDim }} />
            </View>
          )}
        </View>
      </View>

      {budget === undefined ? null : (
        <View
          style={{
            height: 6,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            overflow: 'hidden',
          }}>
          <View
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              borderRadius: Radius.full,
              backgroundColor: over ? colors.negative : category.color,
            }}
          />
        </View>
      )}
    </Pressable>
  );
}
