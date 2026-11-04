import { useRouter } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { dialog } from '@/components/ui/dialog';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlan } from '@/lib/queries';
import {
  useDeleteTransactionAlert,
  useSetTransactionAlertEnabled,
  useTransactionAlerts,
} from '@/lib/transaction-alert-queries';
import {
  alertSummary,
  atFreeAlertLimit,
  FREE_ALERT_LIMIT,
  isPlanLimitError,
} from '@/lib/transaction-alerts';

/** Manage saved transaction alerts under Notifications settings. */
export function TransactionAlertsList({ userId }: { userId: string | undefined }) {
  const colors = useTheme();
  const router = useRouter();
  const { data: plan } = usePlan(userId);
  const { data: alerts = [], isLoading } = useTransactionAlerts(userId);
  const setEnabled = useSetTransactionAlertEnabled(userId);
  const remove = useDeleteTransactionAlert(userId);
  const activeCount = alerts.filter((a) => a.enabled).length;

  const onToggle = (id: string, enabled: boolean, currentlyEnabled: boolean) => {
    if (enabled && !currentlyEnabled && atFreeAlertLimit(activeCount, plan?.plan)) {
      router.push('/paywall');
      return;
    }
    setEnabled.mutate(
      { id, enabled },
      {
        onError: (err) => {
          if (isPlanLimitError(err)) {
            router.push('/paywall');
            return;
          }
          dialog.alert('Could not update alert', err instanceof Error ? err.message : 'Try again.');
        },
      },
    );
  };

  const onDelete = (id: string, label: string) => {
    dialog.alert(`Remove “${label}”?`, 'You can set the alert again from any matching transaction.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove.mutate(id, {
            onError: (err) => dialog.alert('Could not remove', err instanceof Error ? err.message : 'Try again.'),
          }),
      },
    ]);
  };

  return (
    <View style={{ gap: Spacing.sm, paddingTop: Spacing.md }}>
      <AppText variant="label">Transaction alerts</AppText>
      <AppText variant="caption" tone="dim">
        Watch a merchant, a category, or an amount. Free plans keep {FREE_ALERT_LIMIT} active
        {plan?.plan === 'free' ? ` · ${activeCount} of ${FREE_ALERT_LIMIT} used` : ''}.
      </AppText>
      {isLoading ? (
        <AppText variant="caption" tone="dim">
          Loading…
        </AppText>
      ) : alerts.length === 0 ? (
        <AppText variant="caption" tone="dim">
          None yet. Open a transaction and tap the bell to add one.
        </AppText>
      ) : (
        alerts.map((alert) => {
          const label = alertSummary(alert);
          return (
            <View
              key={alert.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.sm,
                paddingVertical: Spacing.xs,
              }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="label">{label}</AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${label}`}
                  onPress={() => onDelete(alert.id, label)}
                  hitSlop={6}>
                  <AppText variant="caption" tone="negative">
                    Remove
                  </AppText>
                </Pressable>
              </View>
              <Switch
                accessibilityLabel={`Alert on for ${label}`}
                trackColor={{ false: colors.elevated, true: colors.brand }}
                value={alert.enabled}
                disabled={!userId || setEnabled.isPending}
                onValueChange={(value) => onToggle(alert.id, value, alert.enabled)}
              />
            </View>
          );
        })
      )}
    </View>
  );
}
