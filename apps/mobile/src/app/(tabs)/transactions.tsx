import { router } from 'expo-router';
import { ArrowLeftRight, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransactionRow } from '@/components/transaction-row';
import { TransactionSortSheet, type TransactionSort } from '@/components/transaction-sort-sheet';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { type Chip, Chips } from '@/components/ui/chips';
import { EmptyState } from '@/components/ui/empty-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isShared, payerLabel } from '@/lib/herd';
import { useSyncTransactions } from '@/lib/plaid';
import { type Transaction, useCategories, useHerd, useTransactions } from '@/lib/queries';

/** The feed's who-paid filter (11a): everyone, one member, or Joint (null). */
type PayerFilter = string | null | 'all';

function compareByDate(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matchesSearch(transaction: Transaction, query: string): boolean {
  const haystack = `${transaction.merchant_name ?? ''} ${transaction.name}`.toLowerCase();
  return haystack.includes(query);
}

/** The empty state under a search, a who-paid filter, or both. */
function noMatchMessage(search: string, payer: string | null): string {
  if (search && payer) return `No ${payer} transactions match "${search}".`;
  if (payer) return payer === 'Joint' ? 'No Joint transactions yet.' : `No transactions for ${payer} yet.`;
  return `No transactions match "${search}".`;
}

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
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error: fetchError } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { sync, isSyncing, error: syncError } = useSyncTransactions();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TransactionSort>('newest');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const { data: herd } = useHerd();
  const shared = isShared(herd);
  const [payerChoice, setPayer] = useState<PayerFilter>('all');
  // Back to everyone once the herd is down to one, or the chosen member left.
  const payer =
    !shared || (payerChoice !== 'all' && payerChoice !== null && !herd?.members.some((m) => m.user_id === payerChoice))
      ? 'all'
      : payerChoice;
  const payerOptions = useMemo<Chip<PayerFilter>[]>(
    () =>
      herd
        ? [
            { value: 'all', label: 'Everyone' },
            ...herd.members.map((m) => ({ value: m.user_id, label: payerLabel(m.user_id, herd.members) })),
            { value: null, label: 'Joint' },
          ]
        : [],
    [herd],
  );

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const query = search.trim().toLowerCase();
  // A search or a non-default sort needs to see the whole history, not just the
  // pages scrolled into view so far — so once either is active, keep pulling
  // pages until the server says there are none left.
  const isFiltering = query !== '' || sort !== 'newest' || payer !== 'all';
  useEffect(() => {
    if (isFiltering && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [isFiltering, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const isLoadingAll = isFiltering && hasNextPage;

  const allLoaded = useMemo(() => data?.pages.flat() ?? [], [data]);
  const filtered = useMemo(
    () =>
      query || payer !== 'all'
        ? allLoaded.filter((t) => (!query || matchesSearch(t, query)) && (payer === 'all' || t.paid_by === payer))
        : allLoaded,
    [allLoaded, query, payer],
  );

  const sorted = useMemo(() => {
    if (sort === 'newest') return filtered; // already the server's order
    const list = [...filtered];
    if (sort === 'oldest') list.sort(compareByDate);
    else if (sort === 'expensive') list.sort((a, b) => a.amount - b.amount);
    else list.sort((a, b) => b.amount - a.amount);
    return list;
  }, [filtered, sort]);

  // Grouping by day only makes sense while sorted by date; an amount sort
  // renders as one flat, unlabeled section instead.
  const sections = useMemo(() => {
    if (sort !== 'newest' && sort !== 'oldest') return [{ title: '', data: sorted }];
    const byDate: { title: string; data: Transaction[] }[] = [];
    for (const transaction of sorted) {
      const title = formatSectionDate(transaction.date);
      const current = byDate[byDate.length - 1];
      if (current && current.title === title) current.data.push(transaction);
      else byDate.push({ title, data: [transaction] });
    }
    return byDate;
  }, [sorted, sort]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <AppText variant="display" style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
        Transactions
      </AppText>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          marginHorizontal: Spacing.md,
          marginBottom: Spacing.sm,
          height: 44,
          paddingHorizontal: Spacing.sm + 2,
          borderRadius: Radius.md,
          backgroundColor: colors.elevated,
        }}>
        <Search size={17} color={colors.textDim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions"
          placeholderTextColor={colors.textDim}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, fontFamily: Type.body, fontSize: 15, color: colors.text, padding: 0 }}
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <X size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
        <View style={{ width: 1, height: 20, backgroundColor: colors.border }} />
        <Pressable onPress={() => setSortSheetOpen(true)} hitSlop={8}>
          <SlidersHorizontal size={18} color={sort !== 'newest' ? colors.brand : colors.textDim} />
        </Pressable>
      </View>

      {shared ? (
        <View style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          <Chips options={payerOptions} selected={payer} onSelect={setPayer} accessibilityLabel="Whose expense" />
        </View>
      ) : null}

      {syncError ? (
        <AppText
          variant="caption"
          tone="negative"
          style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          {syncError}
        </AppText>
      ) : null}
      {fetchError ? (
        <AppText
          variant="caption"
          tone="negative"
          style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          {fetchError.message}
        </AppText>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        // flexGrow so the empty state centres; the list must always render so
        // RefreshControl exists — otherwise there is no way to run a first sync.
        contentContainerStyle={sorted.length === 0 ? { flexGrow: 1 } : undefined}
        ListEmptyComponent={
          isLoading || isLoadingAll ? null : allLoaded.length === 0 ? (
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
          ) : (
            <EmptyState
              icon={Search}
              title="No matches"
              message={noMatchMessage(search.trim(), payer === 'all' ? null : payerLabel(payer, herd?.members ?? []))}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={sync} tintColor={colors.textDim} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        renderSectionHeader={({ section }) =>
          section.title === '' ? null : (
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
          )
        }
        renderItem={({ item }) => (
          <TransactionRow
            transaction={item}
            category={item.category_id ? categoriesById.get(item.category_id) : undefined}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })}
          />
        )}
        ListFooterComponent={
          isFetchingNextPage || isLoadingAll ? (
            <View style={{ alignItems: 'center', gap: Spacing.xs, marginVertical: Spacing.lg }}>
              <ActivityIndicator color={colors.textDim} />
              {isLoadingAll ? (
                <AppText variant="caption" tone="dim">
                  Loading your full history…
                </AppText>
              ) : null}
            </View>
          ) : (
            <View style={{ height: Spacing.xxl }} />
          )
        }
      />

      <TransactionSortSheet
        visible={sortSheetOpen}
        value={sort}
        onSelect={setSort}
        onClose={() => setSortSheetOpen(false)}
      />
    </View>
  );
}
