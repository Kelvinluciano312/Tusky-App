import { router } from 'expo-router';
import { Landmark } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const firstName = session?.user.email?.split('@')[0] ?? 'there';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: insets.top + Spacing.md, gap: Spacing.lg }}>
      <View>
        <AppText tone="dim" variant="caption">
          {greeting()},
        </AppText>
        <AppText variant="display">{firstName}</AppText>
      </View>

      {/* Net worth hero — the ledger voice, oversized */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: Spacing.lg,
          gap: Spacing.xs,
        }}>
        <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Net worth
        </AppText>
        <Amount value={0} size={44} />
        <AppText variant="caption" tone="dim">
          Nothing tracked yet — your trend line starts at your first connection.
        </AppText>
      </View>

      {/* Accounts — empty invitation */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: Spacing.lg,
          alignItems: 'center',
          gap: Spacing.sm,
        }}>
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
      </View>
    </ScrollView>
  );
}
