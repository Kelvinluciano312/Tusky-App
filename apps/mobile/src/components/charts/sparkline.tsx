import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  values: number[];
  width: number;
  height: number;
  color?: string;
};

/**
 * A bare trend line. Sized by explicit props like the donut — nothing here
 * measures its own layout.
 *
 * Points are spaced evenly by index, not by date, so a stretch of days with no
 * sync reads as a single step rather than a flat run. That is the accepted
 * trade for a sparkline sitting under a number; a real chart would need a time
 * axis.
 */
export function Sparkline({ values, width, height, color }: Props) {
  const colors = useTheme();
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const stepX = width / (values.length - 1);

  const points = values
    .map((value, i) => {
      // A flat series (one balance that has not moved) would divide by zero and
      // render nothing. Draw it down the middle instead.
      const t = span === 0 ? 0.5 : (value - min) / span;
      return `${(i * stepX).toFixed(2)},${((1 - t) * height).toFixed(2)}`;
    })
    .join(' ');

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Polyline
          points={points}
          fill="none"
          stroke={color ?? colors.brand}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
