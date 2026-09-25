import { router } from 'expo-router';
import { ArrowLeftRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransactionRow } from '@/components/transaction-row';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSyncTransactions } from '@/lib/plaid';
import { type Transaction, useCategories, useTransactions } from '@/lib/queries';

function formatSectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export default function TransactionsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { sync, isSyncing, error: syncError } = useSyncTransactions();

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Flat pages -> one section per date. Order is already guaranteed by the query.
  const sections = useMemo(() => {
    const all = data?.pages.flat() ?? [];
    const byDate: { title: string; data: Transaction[] }[] = [];
    for (const transaction of all) {
      const title = formatSectionDate(transaction.date);
      const current = byDate[byDate.length - 1];
      if (current && current.title === title) current.data.push(transaction);
      else byDate.push({ title, data: [transaction] });
    }
    return byDate;
  }, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <AppText variant="display" style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
        Transactions
      </AppText>

      {syncError ? (
        <AppText
          variant="caption"
          tone="negative"
          style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          {syncError}
        </AppText>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        // flexGrow so the empty state centres; the list must always render so
        // RefreshControl exists — otherwise there is no way to run a first sync.
        contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : undefined}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={{ flex: 1 }}>
              <EmptyState
                icon={ArrowLeftRight}
                title="No transactions yet"
                message="Sync your connected banks, or add one in Settings."
              />
              {/* Explicit action: pull-to-refresh alone is undiscoverable on an
                  empty screen, and unreachable for anyone not expecting it. */}
              <Button
                title="Sync now"
                loading={isSyncing}
                onPress={sync}
                style={{ marginHorizontal: Spacing.xl, marginTop: -Spacing.lg }}
              />
            </View>
          )
        }
        refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={sync} tintColor={colors.textDim} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        renderSectionHeader={({ section }) => (
          <AppText
            variant="caption"
            tone="dim"
            style={{
              paddingHorizontal: Spacing.md,
              paddingTop: Spacing.md,
              paddingBottom: Spacing.xs,
              backgroundColor: colors.bg,
              textTransform: 'uppercase',
              letterSpacing: 1.1,
            }}>
            {section.title}
          </AppText>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            transaction={item}
            category={item.category_id ? categoriesById.get(item.category_id) : undefined}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })}
          />
        )}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator color={colors.textDim} style={{ marginVertical: Spacing.lg }} />
          ) : (
            <View style={{ height: Spacing.xxl }} />
          )
        }
      />
    </View>
  );
}
