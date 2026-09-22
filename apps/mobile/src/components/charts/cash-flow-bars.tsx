import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { monthShortLabel } from '@/lib/month';
import type { CashFlowMonth } from '@/lib/reports';

type Props = {
  months: CashFlowMonth[];
  height?: number;
};

/**
 * Income against expense, month by month. Plain Views with percentage heights —
 * a bar chart needs no SVG.
 *
 * Bars are scaled to the largest value in the window, so the shape is comparable
 * across months but the axis is relative, not absolute.
 */
export function CashFlowBars({ months, height = 120 }: Props) {
  const colors = useTheme();
  const peak = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 0);

  const bar = (value: number, color: string) => (
    <View
      style={{
        flex: 1,
        // A month with no activity still shows a hairline, so the slot reads as
        // empty rather than broken.
        height: Math.max(peak === 0 ? 0 : (value / peak) * height, value > 0 ? 2 : 1),
        backgroundColor: value > 0 ? color : colors.elevated,
        borderTopLeftRadius: Radius.sm,
        borderTopRightRadius: Radius.sm,
      }}
    />
  );

  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' }}>
      {months.map((month) => (
        <View key={month.month} style={{ flex: 1, alignItems: 'center', gap: Spacing.xs }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 3,
              height,
              alignSelf: 'stretch',
            }}>
            {bar(month.income, colors.positive)}
            {bar(month.expense, colors.negative)}
          </View>
          <AppText variant="caption" tone="dim">
            {monthShortLabel(month.month)}
          </AppText>
        </View>
      ))}
    </View>
  );
}
