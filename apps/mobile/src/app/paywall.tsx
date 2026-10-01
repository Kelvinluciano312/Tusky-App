import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chips } from '@/components/ui/chips';
import { PRIVACY_URL, TERMS_URL } from '@/constants/legal';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  activePeriod,
  afterPurchase,
  offeringsErrorDetail,
  ownPaidPlan,
  type Period,
  PLAN_NAMES,
  paywallTiers,
  planSummary,
  storeName,
  tierAction,
} from '@/lib/paywall';
import { purchasesEnabled, useActiveProducts, useBuy, useOfferings, useRestore } from '@/lib/purchases';
import { useHerd, useHerdPayer, usePlan, usePlanLimits } from '@/lib/queries';
import { useSession } from '@/lib/session';

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
  const { data: packages = [], isLoading, error, refetch } = useOfferings();
  const { data: active = [] } = useActiveProducts();
  const { data: herd } = useHerd();
  const { data: payerId = null } = useHerdPayer(userId, plan?.source === 'herd');
  const buy = useBuy();
  const restore = useRestore();
  const [period, setPeriod] = useState<Period>('yearly');

  const tiers = paywallTiers(packages, limits);
  const own = plan ? ownPaidPlan(plan, new Date()) : null;
  const payerName = herd?.members.find((m) => m.user_id === payerId)?.display_name ?? null;
  const failed = (title: string) => (err: Error) => Alert.alert(title, err.message);

  if (!purchasesEnabled) return <Notice title="Plans are coming soon" body="Everything you have tracked stays here in the meantime." />;
  if (error) {
    return (
      <Notice title="Couldn't load plans" body="The store didn't return the plans. Try again in a moment.">
        <AppText variant="caption" tone="dim" selectable>
          {offeringsErrorDetail(error)}
        </AppText>
        <Button title="Try again" variant="secondary" onPress={() => void refetch()} />
      </Notice>
    );
  }
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={colors.textDim} />
      </View>
    );
  }
  if (tiers.length === 0) return <Notice title="Plans are coming soon" body="Everything you have tracked stays here in the meantime." />;

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
            {planSummary(plan, new Date(), payerName).detail}.{' '}
            {own
              ? `You also pay for a plan yourself; you can cancel it in the ${storeName(plan.store)}.`
              : 'You do not need a plan of your own.'}
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
        const action = tierAction({
          tier: tier.plan,
          period,
          own,
          ownPeriod: own ? activePeriod(active, own) : null,
          planKnown: !!plan,
          hasPackage: !!tier[period],
        });
        const pkg = tier[period];
        return (
          <Card key={tier.plan} style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <AppText variant="section">{tier.name}</AppText>
              {pkg ? (
                <AppText variant="label">
                  {pkg.product.priceString} / {period === 'yearly' ? 'year' : 'month'}
                </AppText>
              ) : (
                <AppText variant="caption" tone="dim">
                  Not sold {period}
                </AppText>
              )}
            </View>
            {tier.lines.map((line) => (
              <AppText key={line} tone="dim">
                {line}
              </AppText>
            ))}
            <Button
              title={action.title}
              disabled={action.disabled || buy.isPending}
              loading={buy.isPending && buy.variables?.plan === tier.plan}
              onPress={() =>
                pkg &&
                buy.mutate(
                  { pkg, plan: tier.plan, period },
                  {
                    onSuccess: ({ outcome, confirmed }) => {
                      if (outcome === 'cancelled') return;
                      const msg = afterPurchase({ outcome, confirmed, name: PLAN_NAMES[tier.plan] });
                      if (msg) Alert.alert(msg.title, msg.body);
                      router.back();
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
        Subscriptions renew until you cancel them in the {storeName(Platform.OS === 'ios' ? 'app_store' : 'play')}.
      </AppText>
      <View style={{ flexDirection: 'row', gap: Spacing.md }}>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
          <AppText variant="caption" tone="brand">
            Privacy policy
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>
          <AppText variant="caption" tone="brand">
            Terms of use
          </AppText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.md }}>
      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section">{title}</AppText>
        <AppText tone="dim">{body}</AppText>
        {children}
      </Card>
    </View>
  );
}
