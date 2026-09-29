import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chips } from '@/components/ui/chips';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { paywallTiers, planSummary } from '@/lib/paywall';
import { purchasesEnabled, useBuy, useOfferings, useRestore } from '@/lib/purchases';
import { useHerd, useHerdPayer, usePlan, usePlanLimits } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Period = 'monthly' | 'yearly';

/**
 * Plans (Phase 14c). Prices are the store's, limits are the `plans` table's,
 * and what a purchase grants is decided by the server after RevenueCat says so.
 */
export default function PaywallScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: plan } = usePlan(userId);
  const { data: limits = [] } = usePlanLimits();
  const { data: packages = [], isLoading, error } = useOfferings();
  const { data: herd } = useHerd();
  const { data: payerId = null } = useHerdPayer(userId, plan?.source === 'herd');
  const buy = useBuy();
  const restore = useRestore();
  const [period, setPeriod] = useState<Period>('yearly');

  const tiers = paywallTiers(packages, limits);
  const payerName = herd?.members.find((m) => m.user_id === payerId)?.display_name ?? null;
  const failed = (title: string) => (err: Error) => Alert.alert(title, err.message);

  if (!purchasesEnabled || error || (!isLoading && tiers.length === 0)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.md }}>
        <Card style={{ gap: Spacing.xs }}>
          <AppText variant="section">Plans are coming soon</AppText>
          <AppText tone="dim">Everything you have tracked stays here in the meantime.</AppText>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <AppText variant="display">Keep your banks connected</AppText>
      <AppText tone="dim">Every plan opens every feature. They differ in how many banks stay connected.</AppText>

      {plan?.source === 'herd' ? (
        <Card style={{ gap: Spacing.xs }}>
          <AppText variant="section">You are already covered</AppText>
          <AppText tone="dim">
            {planSummary(plan, new Date(), payerName).detail}. You do not need a plan of your own.
          </AppText>
        </Card>
      ) : null}

      <Chips<Period>
        accessibilityLabel="Billing period"
        options={[
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ]}
        selected={period}
        onSelect={setPeriod}
      />

      {tiers.map((tier) => {
        const pkg = tier[period] ?? tier.monthly ?? tier.yearly;
        const current = plan?.source === 'own' && plan.plan === tier.plan && plan.status !== 'expired';
        return (
          <Card key={tier.plan} style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <AppText variant="section">{tier.name}</AppText>
              {pkg ? (
                <AppText variant="label">
                  {pkg.product.priceString} / {pkg === tier.yearly ? 'year' : 'month'}
                </AppText>
              ) : null}
            </View>
            {tier.lines.map((line) => (
              <AppText key={line} tone="dim">
                {line}
              </AppText>
            ))}
            <Button
              title={current ? 'Your plan' : `Choose ${tier.name}`}
              disabled={current || !pkg || buy.isPending}
              loading={buy.isPending && buy.variables?.plan === tier.plan}
              onPress={() =>
                pkg &&
                buy.mutate(
                  { pkg, plan: tier.plan },
                  {
                    onSuccess: (r) => {
                      if (r === 'bought') router.back();
                    },
                    onError: failed('Could not complete the purchase'),
                  },
                )
              }
            />
          </Card>
        );
      })}

      <Button
        title="Restore purchases"
        variant="secondary"
        loading={restore.isPending}
        onPress={() => restore.mutate(undefined, { onError: failed('Could not restore purchases') })}
      />
      <AppText variant="caption" tone="dim">
        Subscriptions renew until you cancel them in the Play Store.
      </AppText>
    </ScrollView>
  );
}
