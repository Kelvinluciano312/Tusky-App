import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, monthLabel } from '@/lib/month';

type Props = {
  /** 'YYYY-MM-01'. */
  month: string;
  onChange: (month: string) => void;
  /** Oldest selectable month, inclusive. */
  min?: string;
  /** Newest selectable month, inclusive. */
  max?: string;
};

/** Shared by Budgets and Reports so one control means one thing in both. */
export function MonthStepper({ month, onChange, min, max }: Props) {
  const colors = useTheme();
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  // String compare is safe: 'YYYY-MM-01' sorts chronologically.
  const canGoBack = !min || previous >= min;
  const canGoForward = !max || next <= max;

  const step = {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        disabled={!canGoBack}
        onPress={() => onChange(previous)}
        style={({ pressed }) => [
          step,
          { backgroundColor: pressed ? colors.elevated : 'transparent', opacity: canGoBack ? 1 : 0.3 },
        ]}>
        <ChevronLeft size={20} color={colors.text} strokeWidth={1.75} />
      </Pressable>

      <AppText variant="section">{monthLabel(month)}</AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next month"
        disabled={!canGoForward}
        onPress={() => onChange(next)}
        style={({ pressed }) => [
          step,
          { backgroundColor: pressed ? colors.elevated : 'transparent', opacity: canGoForward ? 1 : 0.3 },
        ]}>
        <ChevronRight size={20} color={colors.text} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}
