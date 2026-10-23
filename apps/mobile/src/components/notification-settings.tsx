import { useState } from 'react';
import { Switch, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chips } from '@/components/ui/chips';
import { dialog } from '@/components/ui/dialog';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { displayedPrefs, useNotificationPrefs, useSetNotificationPref } from '@/lib/notification-prefs';
import {
  formatHour,
  formatThreshold,
  LARGE_CENTS,
  QUIET_ENDS,
  QUIET_STARTS,
  REVIEW_HOURS,
  REVIEW_THRESHOLDS,
} from '@/lib/notifications';
import { enableNotifications } from '@/lib/push';

type BoolKey =
  | 'question_asked'
  | 'question_answered'
  | 'review_digest'
  | 'herd_joined'
  | 'settle_nudge'
  | 'budget_80'
  | 'budget_100'
  | 'weekly_recap'
  | 'large_transaction'
  | 'upcoming_bill'
  | 'price_change'
  | 'trial_ending'
  | 'billing_issue'
  | 'hide_amounts';

const TOGGLES: { key: BoolKey; label: string; caption: string }[] = [
  { key: 'question_asked', label: 'Asked about a transaction', caption: 'When someone in your herd asks you what a purchase was.' },
  { key: 'question_answered', label: 'Your question was answered', caption: 'A quiet notice, without a sound.' },
  { key: 'review_digest', label: 'Review digest', caption: 'Once a day, when enough new transactions are waiting.' },
  { key: 'herd_joined', label: 'Someone joined your herd', caption: 'When a new member accepts an invite.' },
  { key: 'settle_nudge', label: 'Weekly settle-up', caption: 'Sunday, if you and your herd still have a balance to square.' },
  { key: 'budget_80', label: 'Budget at 80%', caption: 'A heads-up before a category is used up.' },
  { key: 'budget_100', label: 'Budget reached', caption: 'When a category hits its monthly budget.' },
  { key: 'weekly_recap', label: 'Weekly spending recap', caption: 'Sunday evening: what you spent and which budgets held.' },
  { key: 'large_transaction', label: 'Large purchase', caption: 'When a new purchase is over the amount you set. Transfers and card payments are skipped.' },
  { key: 'upcoming_bill', label: 'Bill due tomorrow', caption: 'The day before a recurring bill.' },
  { key: 'price_change', label: 'Bill changed price', caption: 'When a recurring amount goes up or down.' },
  { key: 'trial_ending', label: 'Trial ending', caption: 'Three days before, and the day before, your trial ends.' },
  { key: 'billing_issue', label: 'Plan and billing', caption: 'A payment problem, or a few days to choose which banks to keep.' },
];

/** Notifications in Settings. Reconnect alerts stay on; they are how a broken bank gets fixed. */
export function NotificationSettings({ userId }: { userId: string | undefined }) {
  const colors = useTheme();
  const { data } = useNotificationPrefs(userId);
  const setPref = useSetNotificationPref(userId);
  const prefs = displayedPrefs(data);
  const [enabling, setEnabling] = useState(false);

  const save = (patch: Parameters<typeof setPref.mutate>[0]) => {
    setPref.mutate(patch, { onError: () => dialog.alert('Could not save', 'Check your connection and try again.') });
  };

  return (
    <Card style={{ gap: Spacing.sm }}>
      <AppText variant="section" tone="dim">
        Notifications
      </AppText>
      <AppText variant="caption" tone="dim">
        Alerts that a bank needs reconnecting always stay on. Everything else is yours to turn off. Quiet hours hold the rest until morning.
      </AppText>
      <Button
        title="Turn on notifications"
        variant="secondary"
        loading={enabling}
        onPress={() => {
          setEnabling(true);
          void enableNotifications()
            .then((result) => {
              if (result === 'denied') {
                dialog.alert('Notifications are off', 'You can allow them in your phone’s settings, then come back here.');
              } else if (result === 'unsupported') {
                dialog.alert('Not on this device', 'Push notifications need a physical phone.');
              }
            })
            .catch(() => dialog.alert('Could not turn on notifications', 'Check your connection and try again.'))
            .finally(() => setEnabling(false));
        }}
      />

      {TOGGLES.map((toggle) => (
        <View key={toggle.key} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">{toggle.label}</AppText>
            <AppText variant="caption" tone="dim">
              {toggle.caption}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={toggle.label}
            trackColor={{ false: colors.elevated, true: colors.brand }}
            value={prefs[toggle.key]}
            disabled={!userId || setPref.isPending}
            onValueChange={(value) => save({ [toggle.key]: value })}
          />
        </View>
      ))}

      <AppText variant="label">Review digest</AppText>
      <AppText variant="caption" tone="dim">
        Send it when at least this many transactions are waiting, and something new arrived since the last one.
      </AppText>
      <Chips
        accessibilityLabel="Review digest threshold"
        options={REVIEW_THRESHOLDS.map((value) => ({ value, label: String(value) }))}
        selected={prefs.review_threshold as (typeof REVIEW_THRESHOLDS)[number]}
        onSelect={(value) => save({ review_threshold: value })}
      />
      <AppText variant="caption" tone="dim">
        Around this time, in your time zone.
      </AppText>
      <Chips
        accessibilityLabel="Review digest time"
        options={REVIEW_HOURS.map((value) => ({ value, label: formatHour(value) }))}
        selected={prefs.review_hour as (typeof REVIEW_HOURS)[number]}
        onSelect={(value) => save({ review_hour: value })}
      />

      <AppText variant="label">Large purchase</AppText>
      <Chips
        accessibilityLabel="Large purchase amount"
        options={LARGE_CENTS.map((value) => ({ value, label: formatThreshold(value) }))}
        selected={prefs.large_cents as (typeof LARGE_CENTS)[number]}
        onSelect={(value) => save({ large_cents: value })}
      />

      <AppText variant="label">Quiet hours</AppText>
      <AppText variant="caption" tone="dim">
        From
      </AppText>
      <Chips
        accessibilityLabel="Quiet hours start"
        options={QUIET_STARTS.map((value) => ({ value, label: formatHour(value) }))}
        selected={prefs.quiet_start as (typeof QUIET_STARTS)[number]}
        onSelect={(value) => save({ quiet_start: value })}
      />
      <AppText variant="caption" tone="dim">
        until
      </AppText>
      <Chips
        accessibilityLabel="Quiet hours end"
        options={QUIET_ENDS.map((value) => ({ value, label: formatHour(value) }))}
        selected={prefs.quiet_end as (typeof QUIET_ENDS)[number]}
        onSelect={(value) => save({ quiet_end: value })}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }}>
        <View style={{ flex: 1 }}>
          <AppText variant="label">Hide amounts on the lock screen</AppText>
          <AppText variant="caption" tone="dim">
            Dollar amounts are replaced so a glance does not show what was spent. Merchant names stay.
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Hide amounts on the lock screen"
          trackColor={{ false: colors.elevated, true: colors.brand }}
          value={prefs.hide_amounts}
          disabled={!userId || setPref.isPending}
          onValueChange={(value) => save({ hide_amounts: value })}
        />
      </View>
    </Card>
  );
}
