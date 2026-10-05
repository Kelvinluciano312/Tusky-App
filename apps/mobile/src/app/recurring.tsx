import { createEventInCalendarAsync, Frequency } from 'expo-calendar/legacy';
import { Repeat } from 'lucide-react-native';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';

import { RecurringRow } from '@/components/recurring-row';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { eventFor } from '@/lib/calendar';
import { streamName } from '@/lib/merchants';
import {
  type RecurringStream,
  useCategories,
  useMerchantRules,
  useRecurringStreams,
  useSetStreamDismissed,
} from '@/lib/queries';
import { isActive, monthlyEquivalent, todayLocal } from '@/lib/recurring';

export default function RecurringScreen() {
  const colors = useTheme();
  const { data: streams = [], isLoading, isRefetching, refetch } = useRecurringStreams();
  const { data: categories = [] } = useCategories();
  const setDismissed = useSetStreamDismissed();
  const { data: rules = new Map() } = useMerchantRules();
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Per render, not memoized: a screen left open past midnight moves with the day.
  const today = todayLocal();
  const live = streams.filter((s) => !s.dismissed && isActive(s, today));
  const bills = live.filter((s) => s.direction === 'outflow');
  const income = live.filter((s) => s.direction === 'inflow');
  const dismissed = streams.filter((s) => s.dismissed);
  const perMonth = bills.reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  // The phone's own "new event" screen (15g): no calendar permission, and the
  // user picks the calendar (Google on Android, Apple's on iOS) and can edit it.
  const addToCalendar = async (s: RecurringStream) => {
    const name = streamName(s, rules);
    const draft = eventFor(s, name);
    try {
      await createEventInCalendarAsync({
        ...draft,
        recurrenceRule: {
          frequency: draft.recurrenceRule.frequency === 'monthly' ? Frequency.MONTHLY : Frequency.WEEKLY,
          interval: draft.recurrenceRule.interval,
        },
      });
    } catch (err) {
      dialog.alert('Could not open your calendar', err instanceof Error ? err.message : 'Try again in a moment.');
    }
  };

  const confirm = (s: RecurringStream) =>
    s.dismissed
      ? dialog.alert(s.name, 'Treat this as recurring again?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore', onPress: () => setDismissed.mutate({ id: s.id, dismissed: false }) },
        ])
      : dialog.alert(streamName(s, rules), undefined, [
          { text: 'Add to calendar', onPress: () => void addToCalendar(s) },
          {
            text: 'Not recurring',
            style: 'destructive',
            onPress: () => setDismissed.mutate({ id: s.id, dismissed: true }),
          },
          { text: 'Cancel', style: 'cancel' },
        ]);

  const section = (title: string, list: RecurringStream[]) =>
    list.length === 0 ? null : (
      <Card>
        <AppText variant="section" tone="dim" style={{ marginBottom: Spacing.xs }}>
          {title}
        </AppText>
        {list.map((s) => (
          <RecurringRow
            key={s.id}
            stream={s}
            category={s.category_id ? categoriesById.get(s.category_id) : undefined}
            today={today}
            onPress={() => confirm(s)}
          />
        ))}
      </Card>
    );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, gap: Spacing.lg, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.textDim} />}>
      {streams.length === 0 ? (
        isLoading ? null : (
          <EmptyState
            icon={Repeat}
            title="Nothing recurring yet"
            message="Tusky spots a bill or paycheck after three regular charges. Each sync adds history."
          />
        )
      ) : (
        <>
          <View style={{ gap: Spacing.xs }}>
            <Amount value={perMonth} size={32} />
            <AppText variant="caption" tone="dim">
              a month in recurring bills
            </AppText>
          </View>
          {section('Bills & subscriptions', bills)}
          {section('Income', income)}
          {section('Not recurring', dismissed)}
        </>
      )}
    </ScrollView>
  );
}
