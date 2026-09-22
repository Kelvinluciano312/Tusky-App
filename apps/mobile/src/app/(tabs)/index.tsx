import { router } from 'expo-router';
import { Landmark } from 'lucide-react-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRow, signedBalance } from '@/components/account-row';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccounts } from '@/lib/queries';
import { useSession } from '@/lib/session';

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
