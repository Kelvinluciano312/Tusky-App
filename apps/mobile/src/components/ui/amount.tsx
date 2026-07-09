import { Text, type TextStyle } from 'react-native';

import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AmountProps = {
  /** Value in major units (dollars). Negative renders with a minus sign. */
  value: number;
  currency?: string;
  /** Font size of the integer part; cents render smaller and dimmed. */
  size?: number;
  /** Color by sign: positive green, negative default ivory. Off by default. */
  signColor?: boolean;
  /** Show a leading + on positive values (transaction rows). */
  showPlus?: boolean;
  style?: TextStyle;
};

const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * The ledger voice: every monetary amount in Tusky is IBM Plex Mono with
 * grouped digits and de-emphasized cents.
 */
export function Amount({ value, currency = '$', size = 16, signColor = false, showPlus = false, style }: AmountProps) {
  const colors = useTheme();
  const negative = value < 0;
  const abs = Math.abs(value);
  const [intPart, centsPart] = abs.toFixed(2).split('.');

  const mainColor = signColor && !negative && value !== 0 ? colors.positive : colors.text;
  const sign = negative ? '-' : showPlus && value > 0 ? '+' : '';

  return (
    <Text
      style={[
        { fontFamily: Type.mono, fontSize: size, color: mainColor, fontVariant: ['tabular-nums'] },
        style,
      ]}>
      {sign}
      {currency}
      {groupDigits(intPart)}
      <Text style={{ fontSize: Math.round(size * 0.72), color: colors.textDim }}>.{centsPart}</Text>
    </Text>
  );
}
