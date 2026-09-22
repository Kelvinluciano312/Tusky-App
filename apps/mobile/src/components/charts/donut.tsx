import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { useTheme } from '@/hooks/use-theme';
import type { CategorySlice } from '@/lib/reports';

type Props = {
  slices: CategorySlice[];
  size?: number;
  thickness?: number;
};

/**
 * Spending by category.
 *
 * Each slice is one stroked circle whose dash pattern is "draw `length`, then
 * skip the rest", offset by everything drawn before it — arcs with no path
 * geometry. The -90 rotation starts the first slice at twelve o'clock.
 */
export function SpendingDonut({ slices, size = 180, thickness = 22 }: Props) {
  const colors = useTheme();
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.spent, 0);

  // Offsets are accumulated up front: mutating a counter inside the map callback
  // trips the React Compiler's immutability rule.
  const arcs: { id: string; color: string; length: number; offset: number }[] = [];
  let drawn = 0;
  for (const slice of slices) {
    const length = slice.share * circumference;
    arcs.push({ id: slice.id, color: slice.color, length, offset: drawn });
    drawn += length;
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.elevated}
            strokeWidth={thickness}
          />
          {arcs.map((arc) => (
            <Circle
              key={arc.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={`${arc.length} ${circumference - arc.length}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </G>
      </Svg>

      <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.1 }}>
        Spent
      </AppText>
      <Amount value={total} size={22} />
    </View>
  );
}
