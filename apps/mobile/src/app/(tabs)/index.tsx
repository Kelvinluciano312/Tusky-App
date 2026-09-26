import { router } from 'expo-router';
import { ChevronRight, Landmark, ListChecks } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRow } from '@/components/account-row';
import { Sparkline } from '@/components/charts/sparkline';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { UpcomingCard } from '@/components/upcoming-card';
import { GROUP_LABEL, groupAccounts, netWorth } from '@/lib/accounts';
import { firstName } from '@/lib/profile';
import {
  useAccounts,
  useCategories,
  useNetWorthHistory,
  useProfile,
  useRecurringStreams,
  useReviewCount,
} from '@/lib/queries';
import { todayLocal } from '@/lib/recurring';
import { useSession } from '@/lib/session';

/** Days of history under the hero. Also keeps the row count far under max_rows. */
const HISTORY_DAYS = 90;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { data: accounts = [], isRefetching, refetch } = useAccounts();
  const { data: profile } = useProfile(session?.user.id);
  const greetName = profile ? firstName(profile.display_name) : '';

  const visibleAccounts = accounts.filter((a) => !a.hidden);
  const counted = visibleAccounts.filter((a) => a.in_totals).length;
  const total = netWorth(accounts);
  const groups = groupAccounts(accounts);
  const hasAccounts = visibleAccounts.length > 0;

  // Derived per render, NOT memoized with []: a memo froze the window at mount,
  // so an app left open across midnight never asked for the new day's point.
  // The strings only change when the date does, so the query key is stable
  // within a day. UTC on purpose: snapshot dates are UTC (current_date).
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - HISTORY_DAYS);
  const from = start.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  const { data: history = [], refetch: refetchHistory } = useNetWorthHistory(from, to);
  const { data: streams = [], refetch: refetchStreams } = useRecurringStreams();
  const { data: toReview = 0, refetch: refetchReview } = useReviewCount();
  const { data: categories = [] } = useCategories();
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = todayLocal();
  const trend = history.map((point) => point.net_worth);
  const change = trend.length >= 2 ? trend[trend.length - 1] - trend[0] : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: insets.top + Spacing.md, gap: Spacing.lg }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => {
            refetch();
            refetchHistory();
            refetchStreams();
            refetchReview();
          }}
          tintColor={colors.textDim}
        />
      }>
      <View>
        <AppText tone="dim" variant="caption">
          {greeting()},
        </AppText>
        <AppText variant="display">{greetName}</AppText>
      </View>

      {/* Net worth hero — the ledger voice, oversized */}
      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Net worth
        </AppText>
        <Amount value={total} size={44} />

        {/* Below two points there is no line to draw, and the copy below already
            explains why. History only starts at the first sync. */}
        {trend.length >= 2 ? (
          <View style={{ gap: Spacing.xs, marginTop: Spacing.xs }}>
            <Sparkline values={trend} width={260} height={48} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
              <Amount value={change} size={13} signColor showPlus />
              <AppText variant="caption" tone="dim">
                over {HISTORY_DAYS} days
              </AppText>
            </View>
          </View>
        ) : null}

        <AppText variant="caption" tone="dim">
          {hasAccounts
            ? `Across ${counted} account${counted === 1 ? '' : 's'}${
                counted < visibleAccounts.length ? ` · ${visibleAccounts.length - counted} not counted` : ''
              }`
            : 'Nothing tracked yet — your trend line starts at your first connection.'}
        </AppText>
      </Card>

      {toReview > 0 ? (
        <Pressable onPress={() => router.push('/review')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <ListChecks size={22} color={colors.brand} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <AppText variant="title">
                {toReview} to review
              </AppText>
              <AppText variant="caption" tone="dim">
                New transactions since your last look
              </AppText>
            </View>
            <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
          </Card>
        </Pressable>
      ) : null}

      <UpcomingCard streams={streams} categoriesById={categoriesById} today={today} />

      {hasAccounts ? (
        /* By kind of money (Phase 10): each group with its subtotal, which, like
           the headline, leaves out accounts not counted in totals. */
        <Card style={{ gap: Spacing.md }}>
          {groups.map(({ group, accounts: members, total: subtotal }) => (
            <View key={group}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs }}>
                <AppText variant="section" tone="dim">
                  {GROUP_LABEL[group]}
                </AppText>
                <Amount value={subtotal} size={14} />
              </View>
              {members.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  dimmed={!account.in_totals}
                  onPress={() => router.push({ pathname: '/bank/[id]', params: { id: account.item_id } })}
                />
              ))}
            </View>
          ))}
        </Card>
      ) : (
        <Card style={{ alignItems: 'center', gap: Spacing.sm }}>
          <Landmark size={26} color={colors.brand} strokeWidth={1.75} />
          <AppText variant="title">Connect your first bank</AppText>
          <AppText tone="dim" style={{ textAlign: 'center' }}>
            Tusky syncs accounts, balances, and transactions automatically once a bank is linked.
          </AppText>
          <Button
            title="Connect a bank"
            onPress={() => router.push('/settings')}
            style={{ alignSelf: 'stretch', marginTop: Spacing.sm }}
          />
        </Card>
      )}
    </ScrollView>
  );
}
