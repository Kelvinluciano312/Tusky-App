import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { RecurringRow } from '@/components/recurring-row';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import type { Category, RecurringStream } from '@/lib/queries';
import { upcomingBills } from '@/lib/recurring';

const UPCOMING_DAYS = 14;
const MAX_ROWS = 5;

type Props = {
  streams: RecurringStream[];
  categoriesById: Map<string, Category>;
  /** Local 'YYYY-MM-DD'. */
  today: string;
};

/** Bills due in the next two weeks. Renders nothing until detection has found anything at all. */
export function UpcomingCard({ streams, categoriesById, today }: Props) {
  if (streams.length === 0) return null;

  const due = upcomingBills(streams, today, UPCOMING_DAYS);
  const total = due.reduce((sum, s) => sum + s.last_amount, 0);

  return (
    <Card style={{ gap: Spacing.xs }}>
      <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
        Upcoming · next {UPCOMING_DAYS} days
      </AppText>

      {due.length === 0 ? (
        <AppText tone="dim">Nothing due in the next two weeks.</AppText>
      ) : (
        due.slice(0, MAX_ROWS).map((s) => (
          <RecurringRow
            key={s.id}
            stream={s}
            category={s.category_id ? categoriesById.get(s.category_id) : undefined}
            today={today}
          />
        ))
      )}
      {due.length > MAX_ROWS ? (
        <AppText variant="caption" tone="dim">
          {due.length - MAX_ROWS} more
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs }}>
        {due.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            <Amount value={total} size={14} />
            <AppText variant="caption" tone="dim">
              due
            </AppText>
          </View>
        ) : (
          <View />
        )}
        <Pressable onPress={() => router.push('/recurring')} hitSlop={8}>
          <AppText variant="label" tone="brand">
            See all ›
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}
