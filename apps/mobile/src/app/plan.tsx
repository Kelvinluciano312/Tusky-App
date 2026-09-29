import { router } from 'expo-router';
import { Alert, Linking, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlanBanner } from '@/components/plan-banner';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bankUsage, planSummary } from '@/lib/paywall';
import { manageSubscriptionsUrl, purchasesEnabled, useRestore } from '@/lib/purchases';
import { useHerd, useHerdPayer, usePlan } from '@/lib/queries';
import { useSession } from '@/lib/session';

/** Your plan (Phase 14c): what it is, where it comes from, and how many banks it holds. */
export default function PlanScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: plan } = usePlan(userId);
  const { data: herd } = useHerd();
  const { data: payerId = null } = useHerdPayer(userId, plan?.source === 'herd');
  const restore = useRestore();

  if (!plan) return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} />;

  const payerName = herd?.members.find((m) => m.user_id === payerId)?.display_name ?? null;
  const summary = planSummary(plan, new Date(), payerName);
  const paysForHerd = plan.source === 'own' && plan.plan === 'tusk_herd' && plan.status !== 'expired';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <PlanBanner userId={userId} />
      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="display">{summary.title}</AppText>
        <AppText tone="dim">{summary.detail}</AppText>
        <AppText variant="label" style={{ marginTop: Spacing.sm }}>
          {bankUsage(plan.banks_used, plan.max_banks)}
        </AppText>
      </Card>

      <Button title="See plans" onPress={() => router.push('/paywall')} />
      {paysForHerd ? (
        <Button title="Invite someone to your herd" variant="secondary" onPress={() => router.push('/herd')} />
      ) : null}
      {plan.source === 'own' && plan.store === 'play' ? (
        <Button
          title="Manage subscription"
          variant="secondary"
          onPress={async () => Linking.openURL(await manageSubscriptionsUrl())}
        />
      ) : null}
      {purchasesEnabled ? (
        <Button
          title="Restore purchases"
          variant="secondary"
          loading={restore.isPending}
          onPress={() =>
            restore.mutate(undefined, { onError: (err) => Alert.alert('Could not restore purchases', err.message) })
          }
        />
      ) : null}
      <AppText variant="caption" tone="dim">
        Cancel or change payment in the Play Store. Everything you have tracked stays in Tusky whatever your plan.
      </AppText>
    </ScrollView>
  );
}
