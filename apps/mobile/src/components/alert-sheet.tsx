import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { dialog } from '@/components/ui/dialog';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { modalGate } from '@/lib/modal-gate';
import { usePlan } from '@/lib/queries';
import { useSession } from '@/lib/session';
import {
  useDeleteTransactionAlert,
  useTransactionAlerts,
  useUpsertTransactionAlert,
} from '@/lib/transaction-alert-queries';
import {
  alertSummary,
  atFreeAlertLimit,
  findMatchingAlert,
  FREE_ALERT_LIMIT,
  isPlanLimitError,
  minCentsToDollars,
  type AlertDraft,
  type TransactionAlert,
} from '@/lib/transaction-alerts';

export type AlertSheetSeed = {
  merchantEntityId: string | null;
  merchantKey: string | null;
  merchantLabel: string;
  categoryId: string | null;
  categoryLabel: string | null;
};

type Props = {
  visible: boolean;
  seed: AlertSheetSeed | null;
  onClose: () => void;
};

/**
 * Create or edit a transaction alert from a review card or transaction detail.
 * Closes before opening the paywall so iOS never stacks Modal-over-Sheet (#76).
 */
export function AlertSheet({ visible, seed, onClose }: Props) {
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: alerts = [] } = useTransactionAlerts(userId);

  const existing = useMemo(() => {
    if (!seed) return undefined;
    return (
      findMatchingAlert(alerts, {
        merchantEntityId: seed.merchantEntityId,
        merchantKey: seed.merchantKey,
        categoryId: seed.categoryId,
        minDollars: null,
      }) ||
      alerts.find(
        (a) =>
          (seed.merchantEntityId && a.merchant_entity_id === seed.merchantEntityId) ||
          (seed.merchantKey && a.merchant_key === seed.merchantKey && !a.merchant_entity_id),
      ) ||
      alerts.find((a) => seed.categoryId && a.category_id === seed.categoryId && !a.merchant_key && !a.merchant_entity_id)
    );
  }, [alerts, seed]);

  // Remount the form when the sheet opens for a seed so state seeds once (no setState-in-effect).
  const formKey = visible && seed
    ? `${seed.merchantEntityId ?? ''}:${seed.merchantKey ?? ''}:${seed.categoryId ?? ''}:${existing?.id ?? 'new'}:${existing?.updated_at ?? ''}`
    : 'closed';

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md }}>
      {seed ? (
        <AlertSheetForm
          key={formKey}
          seed={seed}
          existing={existing}
          alerts={alerts}
          userId={userId}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function AlertSheetForm({
  seed,
  existing,
  alerts,
  userId,
  onClose,
}: {
  seed: AlertSheetSeed;
  existing: TransactionAlert | undefined;
  alerts: TransactionAlert[];
  userId: string | undefined;
  onClose: () => void;
}) {
  const colors = useTheme();
  const router = useRouter();
  const { data: plan } = usePlan(userId);
  const upsert = useUpsertTransactionAlert(userId);
  const remove = useDeleteTransactionAlert(userId);

  const [onMerchant, setOnMerchant] = useState(
    existing ? !!(existing.merchant_entity_id || existing.merchant_key) : !!(seed.merchantEntityId || seed.merchantKey),
  );
  const [onCategory, setOnCategory] = useState(existing ? !!existing.category_id : false);
  const [minText, setMinText] = useState(() => {
    const dollars = existing ? minCentsToDollars(existing.min_cents) : null;
    return dollars != null ? String(dollars) : '';
  });
  const [enabled, setEnabled] = useState(existing ? existing.enabled : true);

  const canMerchant = !!(seed.merchantEntityId || seed.merchantKey);
  const canCategory = !!seed.categoryId;
  const parsedMin = (() => {
    const t = minText.trim();
    if (!t) return null;
    const n = Number(t.replace(/[$,]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const draft: AlertDraft = {
    merchantEntityId: onMerchant ? seed.merchantEntityId : null,
    merchantKey: onMerchant ? seed.merchantKey : null,
    merchantLabel: onMerchant ? seed.merchantLabel : null,
    categoryId: onCategory ? seed.categoryId : null,
    categoryLabel: onCategory ? seed.categoryLabel : null,
    minDollars: parsedMin,
    enabled,
  };

  const activeCount = alerts.filter((a) => a.enabled).length;
  const enablingNew =
    enabled && (!existing || !existing.enabled) && atFreeAlertLimit(activeCount, plan?.plan);

  /** Paywall is a Modal presentation; wait for the sheet gate so iOS does not freeze (#76). */
  const openPaywall = () => {
    onClose();
    const tryOpen = () => {
      if (modalGate.isClear()) {
        router.push('/paywall');
        return;
      }
      const unsub = modalGate.subscribe(() => {
        if (!modalGate.isClear()) return;
        unsub();
        router.push('/paywall');
      });
    };
    setTimeout(tryOpen, 0);
  };

  const save = () => {
    if (!draft.merchantEntityId && !draft.merchantKey && !draft.categoryId && draft.minDollars == null) {
      dialog.alert('Nothing to alert on', 'Turn on a merchant or category, or set a minimum amount.');
      return;
    }
    if (enablingNew) {
      openPaywall();
      return;
    }
    upsert.mutate(
      { id: existing?.id, draft },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          if (isPlanLimitError(err)) {
            openPaywall();
            return;
          }
          dialog.alert('Could not save alert', err instanceof Error ? err.message : 'Try again.');
        },
      },
    );
  };

  const turnOff = () => {
    if (!existing) {
      onClose();
      return;
    }
    remove.mutate(existing.id, {
      onSuccess: () => onClose(),
      onError: (err) => dialog.alert('Could not remove alert', err instanceof Error ? err.message : 'Try again.'),
    });
  };

  return (
    <SheetScroll contentContainerStyle={{ gap: Spacing.md }}>
      <AppText variant="title">Transaction alert</AppText>
      <AppText variant="caption" tone="dim">
        Push when a matching purchase posts
        {plan?.plan === 'free' ? ` · ${FREE_ALERT_LIMIT} free` : ''}.
        {existing ? ` Editing “${alertSummary(existing)}”.` : ''}
      </AppText>

      {canMerchant ? (
        <Row
          label={`This merchant (${seed.merchantLabel})`}
          value={onMerchant}
          onChange={setOnMerchant}
          colors={colors}
        />
      ) : null}
      {canCategory ? (
        <Row
          label={`This category (${seed.categoryLabel ?? 'Category'})`}
          value={onCategory}
          onChange={setOnCategory}
          colors={colors}
        />
      ) : null}

      <TextField
        label="Minimum amount (optional)"
        value={minText}
        onChangeText={setMinText}
        keyboardType="decimal-pad"
        placeholder="Any amount"
      />
      <AppText variant="caption" tone="dim">
        Leave blank for any amount. Alone, this alerts on every posted transaction at or above it.
      </AppText>

      <Row label="Alert on" value={enabled} onChange={setEnabled} colors={colors} />

      <Button
        title={enablingNew ? 'See plans' : existing ? 'Save alert' : 'Turn on alert'}
        loading={upsert.isPending}
        onPress={save}
      />
      {existing ? (
        <Button title="Remove alert" variant="ghost" loading={remove.isPending} onPress={turnOff} />
      ) : null}
    </SheetScroll>
  );
}

function Row({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: { elevated: string; brand: string };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
      <AppText variant="label" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Switch
        accessibilityLabel={label}
        trackColor={{ false: colors.elevated, true: colors.brand }}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}
