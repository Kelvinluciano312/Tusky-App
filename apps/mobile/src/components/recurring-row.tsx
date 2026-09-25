import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { streamName } from '@/lib/merchants';
import { type Category, type RecurringStream, useMerchantRules } from '@/lib/queries';
import { frequencyLabel, relativeDay } from '@/lib/recurring';

type Props = {
  stream: RecurringStream;
  category?: Category;
  /** Local 'YYYY-MM-DD', from todayLocal(). */
  today: string;
  onPress?: () => void;
};

export function RecurringRow({ stream, category, today, onPress }: Props) {
  const colors = useTheme();
  const tint = category?.color ?? colors.textDim;
  const { data: rules = new Map() } = useMerchantRules();
  const when = relativeDay(stream.next_date, today);
  const change = stream.amount_change;
  // Paying more for a bill is bad news; being paid more is good news.
  const changeTone = change !== null && (change > 0) === (stream.direction === 'inflow') ? 'positive' : 'negative';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm,
        opacity: stream.dismissed ? 0.5 : 1,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <CategoryIcon name={category?.icon} size={16} color={tint} />
      </View>

      <View style={{ flex: 1, paddingRight: Spacing.sm }}>
        <AppText variant="label" numberOfLines={1}>
          {streamName(stream, rules)}
        </AppText>
        <AppText variant="caption" tone="dim" numberOfLines={1}>
          {frequencyLabel(stream.frequency)} · {stream.next_date < today ? `Expected ${when}` : when}
        </AppText>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <Amount value={stream.last_amount} size={15} signColor showPlus />
        {change !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <AppText variant="caption" tone={changeTone}>
              {change > 0 ? '↑' : '↓'}
            </AppText>
            <Amount value={Math.abs(change)} size={12} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
