import { router } from 'expo-router';
import { Landmark } from 'lucide-react-native';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRow, signedBalance } from '@/components/account-row';
import { Sparkline } from '@/components/charts/sparkline';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccounts, useNetWorthHistory } from '@/lib/queries';
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
  const firstName = session?.user.email?.split('@')[0] ?? 'there';

  const visibleAccounts = accounts.filter((a) => !a.hidden);
  const netWorth = visibleAccounts.reduce((sum, a) => sum + signedBalance(a), 0);
  const hasAccounts = visibleAccounts.length > 0;

  // Memoized: computing these inline would hand the query a new key every render.
  const [from, to] = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - HISTORY_DAYS);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return [iso(start), iso(today)];
  }, []);

  const { data: history = [] } = useNetWorthHistory(from, to);
  const trend = history.map((point) => point.net_worth);
  const change = trend.length >= 2 ? trend[trend.length - 1] - trend[0] : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: insets.top + Spacing.md, gap: Spacing.lg }}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.textDim} />
      }>
      <View>
        <AppText tone="dim" variant="caption">
          {greeting()},
        </AppText>
        <AppText variant="display">{firstName}</AppText>
      </View>

      {/* Net worth hero — the ledger voice, oversized */}
      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Net worth
        </AppText>
        <Amount value={netWorth} size={44} />

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
            ? `Across ${visibleAccounts.length} account${visibleAccounts.length === 1 ? '' : 's'}`
            : 'Nothing tracked yet — your trend line starts at your first connection.'}
        </AppText>
      </Card>

      {hasAccounts ? (
        <Card>
          <AppText variant="section" tone="dim" style={{ marginBottom: Spacing.xs }}>
            Accounts
          </AppText>
          {visibleAccounts.map((account) => (
            <AccountRow key={account.id} account={account} />
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
