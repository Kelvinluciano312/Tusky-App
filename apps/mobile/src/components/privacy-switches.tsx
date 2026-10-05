import { Sparkles, UsersRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';

import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCrowdConsent, useProfile, useSetAiCategorize, useSetCrowdConsent } from '@/lib/queries';
import { useSession } from '@/lib/session';

const failed = () => dialog.alert('Could not change that', 'Check your connection and try again.');

function SwitchRow({
  icon,
  label,
  caption,
  value,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  caption: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }}>
      {icon}
      <View style={{ flex: 1 }}>
        <AppText variant="label">{label}</AppText>
        <AppText variant="caption" tone="dim">
          {caption}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        trackColor={{ false: colors.elevated, true: colors.brand }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}

/** The AI fallback switch (12b), off until the user turns it on. */
export function AiSwitch() {
  const colors = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: profile } = useProfile(userId);
  const set = useSetAiCategorize();
  return (
    <SwitchRow
      icon={<Sparkles size={20} color={colors.brand} strokeWidth={1.75} />}
      label="Let AI help sort and review"
      caption="Places transactions nothing else could, using your own categories too, puts the ones worth a second look first in Review, and spots costs you may want to split. It sees the merchant, the amount, the description your bank sent and the category — never your balances, your accounts or who you are."
      value={profile?.ai_categorize ?? false}
      disabled={!userId || set.isPending}
      onChange={(enabled) => userId && set.mutate({ userId, enabled }, { onError: failed })}
    />
  );
}

/** Crowd labels (12c): on for new accounts since 15c; off withdraws and forgets. */
export function CrowdSwitch() {
  const colors = useTheme();
  const { session } = useSession();
  const { data: on } = useCrowdConsent(session?.user.id);
  const set = useSetCrowdConsent();
  return (
    <SwitchRow
      icon={<UsersRound size={20} color={colors.brand} strokeWidth={1.75} />}
      label="Share my fixes, anonymously"
      caption="When you fix a category, the merchant and your choice join a pool that helps every Tusky user. Never your name, your accounts or exact amounts. A category comes from the pool only once three people agree. Turning this off deletes what you shared."
      value={on ?? false}
      disabled={!session?.user.id || set.isPending}
      onChange={(granted) => set.mutate(granted, { onError: failed })}
    />
  );
}
