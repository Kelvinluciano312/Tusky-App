import { router } from 'expo-router';
import { ArrowLeftRight, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/category-picker';
import { MerchantPicker } from '@/components/merchant-picker';
import { TransactionFilterSheet, type TransactionSort } from '@/components/transaction-filter-sheet';
import { TransactionRow } from '@/components/transaction-row';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Column } from '@/components/ui/column';
import { EmptyState } from '@/components/ui/empty-state';
import { Layout, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { groupIdOf } from '@/lib/categories';
import { isShared, payerLabel } from '@/lib/herd';
import { transactionName } from '@/lib/merchants';
import { useSyncTransactions } from '@/lib/plaid';
import { type Transaction, useAccounts, useCategories, useHerd, useMerchantRules, useTransactions } from '@/lib/queries';
import {
  activeChips,
  type Filters,
  isFiltered,
  matchesFilters,
  matchesSearch,
  merchantOptions,
  NO_FILTERS,
  type SpentBy,
  withoutChip,
} from '@/lib/transaction-filters';

function compareByDate(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The empty state under a search, filters, or both. */
function noMatchMessage(search: string, filtered: boolean): string {
  if (search && filtered) return `Nothing matches "${search}" with these filters.`;
  if (filtered) return 'Nothing matches these filters.';
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

/** Which sheet is up. One at a time: a Modal inside a Modal breaks Android rendering. */
type Open = null | 'filters' | 'category' | 'merchant';

export default function TransactionsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error: fetchError } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: rules = new Map() } = useMerchantRules();
  const { data: accounts = [] } = useAccounts();
  const { sync, isSyncing, error: syncError } = useSyncTransactions();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TransactionSort>('newest');
  const [filterChoice, setFilters] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState<Open>(null);
  // Bumped on each opening of the filter sheet, so its typed amounts start from the filters.
  const [opened, setOpened] = useState(0);
  const { data: herd } = useHerd();
  const shared = isShared(herd);

  // Back to everyone once the herd is down to one, or the chosen member left.
  const filters = useMemo(() => {
    const gone =
      filterChoice.spentBy !== 'all' &&
      (!shared || (filterChoice.spentBy !== null && !herd?.members.some((m) => m.user_id === filterChoice.spentBy)));
    return gone ? { ...filterChoice, spentBy: 'all' as SpentBy } : filterChoice;
  }, [filterChoice, shared, herd]);

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const people = useMemo(
    () =>
      shared && herd
        ? [
            ...herd.members.map((m) => ({ value: m.user_id as SpentBy, label: payerLabel(m.user_id, herd.members) })),
            { value: null as SpentBy, label: 'Joint' },
          ]
        : [],
    [herd, shared],
  );

  const query = search.trim().toLowerCase();
  const filtering = isFiltered(filters);
  // A search, a filter or a non-default sort needs to see the whole history,
  // not just the pages scrolled into view so far — so once any is active, keep
  // pulling pages until the server says there are none left.
  const isFiltering = query !== '' || sort !== 'newest' || filtering;
  useEffect(() => {
    if (isFiltering && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [isFiltering, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const isLoadingAll = isFiltering && hasNextPage;

  const allLoaded = useMemo(() => data?.pages.flat() ?? [], [data]);
  const filtered = useMemo(() => {
    if (!query && !filtering) return allLoaded;
    const groupOf = (id: string) => groupIdOf(id, categoriesById);
    return allLoaded.filter((t) => matchesSearch(t, query) && matchesFilters(t, filters, groupOf));
  }, [allLoaded, query, filtering, filters, categoriesById]);

  const sorted = useMemo(() => {
    if (sort === 'newest') return filtered; // already the server's order
    const list = [...filtered];
    if (sort === 'oldest') list.sort(compareByDate);
    else if (sort === 'expensive') list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    else list.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
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

  const merchants = useMemo(() => merchantOptions(allLoaded, (t) => transactionName(t, rules)), [allLoaded, rules]);
  const merchantName = (key: string) => merchants.find((m) => m.key === key)?.name ?? 'Merchant';
  const chips = activeChips(filters, {
    category: (id) => categoriesById.get(id)?.name ?? 'Category',
    merchant: merchantName,
    account: (id) => accountsById.get(id)?.name ?? 'Account',
    person: (id) => (id === null ? 'Joint' : payerLabel(id, herd?.members ?? [])),
  });
  const sortLabel = { newest: null, oldest: 'Oldest first', expensive: 'Biggest first', cheap: 'Smallest first' }[sort];

  const openFilters = () => {
    setOpened((n) => n + 1);
    setOpen('filters');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Title, search and filters share the feed's centred column on a tablet. */}
      <Column>
      <AppText variant="display" style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
        Transactions
      </AppText>

      {/* Extra top margin: Expo's dev-client menu bubble sits fixed in this
          corner during development, and would otherwise steal the filter
          icon's taps. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          marginHorizontal: Spacing.md,
          marginTop: Spacing.sm,
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
        <Pressable onPress={openFilters} hitSlop={8} accessibilityLabel="Filter and sort">
          <SlidersHorizontal size={18} color={filtering || sort !== 'newest' ? colors.brand : colors.textDim} />
        </Pressable>
      </View>

      {chips.length > 0 || sortLabel ? (
        /* Active filters, each removable; one quiet row so the feed stays the focus. */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.xs + 2 }}>
          {sortLabel ? <ActiveChip label={sortLabel} onRemove={() => setSort('newest')} /> : null}
          {chips.map((chip) => (
            <ActiveChip key={chip.key} label={chip.label} onRemove={() => setFilters(withoutChip(filters, chip.key))} />
          ))}
        </ScrollView>
      ) : null}

      {syncError ? (
        <AppText variant="caption" tone="negative" style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          {syncError}
        </AppText>
      ) : null}
      {fetchError ? (
        <AppText variant="caption" tone="negative" style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          {fetchError.message}
        </AppText>
      ) : null}

      </Column>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        // flexGrow so the empty state centres; the list must always render so
        // RefreshControl exists — otherwise there is no way to run a first sync.
        contentContainerStyle={sorted.length === 0 ? { ...Layout.column, flexGrow: 1 } : Layout.column}
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
            <EmptyState icon={Search} title="No matches" message={noMatchMessage(search.trim(), filtering)} />
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

      <TransactionFilterSheet
        key={opened}
        visible={open === 'filters'}
        sort={sort}
        filters={filters}
        onSort={setSort}
        onChange={setFilters}
        onClose={() => setOpen(null)}
        onPickCategory={() => setOpen('category')}
        onPickMerchant={() => setOpen('merchant')}
        categoryName={filters.category ? (categoriesById.get(filters.category)?.name ?? 'Category') : null}
        merchantName={filters.merchant !== null ? merchantName(filters.merchant) : null}
        accounts={accounts.filter((a) => !a.hidden).map((a) => ({ id: a.id, name: a.mask ? `${a.name} ···· ${a.mask}` : a.name }))}
        people={people}
      />
      <CategoryPicker
        visible={open === 'category'}
        selectedId={filters.category}
        onSelect={(category) => {
          setFilters({ ...filters, category: category.id });
          setOpen('filters');
        }}
        onClose={() => setOpen('filters')}
      />
      <MerchantPicker
        visible={open === 'merchant'}
        options={merchants}
        selected={filters.merchant}
        onSelect={(merchant) => setFilters({ ...filters, merchant })}
        onClose={() => setOpen('filters')}
      />
    </View>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`Remove filter: ${label}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: Spacing.xs,
        paddingLeft: Spacing.sm + 2,
        paddingRight: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: pressed ? colors.elevated : colors.surface,
        borderWidth: 1,
        borderColor: colors.brand,
      })}>
      <AppText variant="caption">{label}</AppText>
      <X size={13} color={colors.textDim} />
    </Pressable>
  );
}
