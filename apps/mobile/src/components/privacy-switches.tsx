import { ShieldCheck, Sparkles, UsersRound } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Switch, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';

import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CodeSheet } from '@/components/code-sheet';
import { confirmLoginCode, sendLoginCode } from '@/lib/login-code';
import { useCrowdConsent, useProfile, useSetAiCategorize, useSetCrowdConsent, useSetTwoFactor } from '@/lib/queries';
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

/**
 * Two-step sign-in (16e). Both directions ask for a fresh emailed code first:
 * turning it on proves the mailbox can receive, and `set_two_factor` itself
 * refuses to turn it off without one. The code replaces the session, which is
 * expected: the new one carries the proof the database looks for.
 */
export function TwoFactorSwitch() {
  const colors = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;
  const email = session?.user.email ?? '';
  const { data: profile } = useProfile(userId);
  const set = useSetTwoFactor();
  // null = sheet closed; otherwise the state being switched to.
  const [target, setTarget] = useState<boolean | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const send = async () => {
    setSentAt(Date.now());
    setSendError(await sendLoginCode(email));
  };

  const open = (next: boolean) => {
    setTarget(next);
    setSentAt(null);
    setSendError(null);
    void send();
  };

  const submit = async (code: string): Promise<string | null> => {
    const failure = await confirmLoginCode(email, code);
    if (failure) return failure;
    const next = target === true;
    try {
      await set.mutateAsync(next);
    } catch {
      return next ? 'Could not turn two-step sign-in on. Try again.' : 'Could not turn two-step sign-in off. Try again.';
    }
    setTarget(null);
    dialog.alert(
      next ? 'Two-step sign-in is on' : 'Two-step sign-in is off',
      next ? 'Next time you sign in, we will email you a code.' : 'You will sign in with just your password again.',
    );
    return null;
  };

  const turningOn = target === true;
  return (
    <>
      <SwitchRow
        icon={<ShieldCheck size={20} color={colors.brand} strokeWidth={1.75} />}
        label="Two-step sign-in"
        caption={`We email a code each time you sign in on a new session. Make sure you can receive mail at ${email}.`}
        value={profile?.two_factor ?? false}
        disabled={!userId || !profile || target !== null}
        onChange={open}
      />
      <CodeSheet
        key={String(target !== null)}
        visible={target !== null}
        title={turningOn ? 'Turn on two-step sign-in' : 'Turn off two-step sign-in'}
        message={
          turningOn
            ? `We emailed a code to ${email}. Enter it to confirm you can receive mail there.`
            : `We emailed a code to ${email}. Enter it to turn two-step sign-in off.`
        }
        sentAt={sentAt}
        sendError={sendError}
        onSubmit={submit}
        onResend={() => void send()}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
