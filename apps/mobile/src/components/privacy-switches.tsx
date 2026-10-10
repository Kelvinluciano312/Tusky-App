import { Lock, ShieldCheck, Sparkles, UsersRound } from 'lucide-react-native';
import { type ReactNode, useRef, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';

import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppLock } from '@/components/app-lock';
import { CodeSheet } from '@/components/code-sheet';
import { canLockHere, promptUnlock, useLockMethodLabel } from '@/lib/app-lock-auth';
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
 * refuses to turn it off without a verified session. Confirming the code marks
 * this session on the server (it is not replaced), then `set_two_factor` runs.
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
  // The server accepted the code: a retry after a failed switch must not spend it again.
  const confirmed = useRef(false);

  const send = async () => {
    setSentAt(Date.now());
    const failure = await sendLoginCode(email);
    setSendError(failure?.message ?? null);
    if (failure && !failure.sent) setSentAt(null);
  };

  const open = (next: boolean) => {
    confirmed.current = false;
    setTarget(next);
    setSentAt(null);
    setSendError(null);
    void send();
  };

  const submit = async (code: string): Promise<string | null> => {
    if (!confirmed.current) {
      const failure = await confirmLoginCode(code);
      if (failure) return failure;
      confirmed.current = true;
    }
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

/**
 * App lock (Phase 17): this device only, never synced to the account. Both
 * directions need one successful unlock first, so a borrowed, unlocked phone
 * cannot switch the lock off.
 */
export function AppLockSwitch() {
  const colors = useTheme();
  const { enabled, setEnabled } = useAppLock();
  const method = useLockMethodLabel();
  const [busy, setBusy] = useState(false);

  const change = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next && !(await canLockHere())) {
        dialog.alert('Cannot turn on App lock', 'Set up Face ID, a fingerprint or a passcode on this device first.');
        return;
      }
      const proof = await promptUnlock(next ? 'Turn on App lock' : 'Turn off App lock');
      if (!proof.ok) {
        if (proof.message) dialog.alert("Could not confirm it's you", proof.message);
        return;
      }
      await setEnabled(next);
    } catch {
      failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SwitchRow
      icon={<Lock size={20} color={colors.brand} strokeWidth={1.75} />}
      label={`Lock with ${method}`}
      caption={
        `Asks for ${method} when you open Tusky and after a minute away. Only on this device.` +
        (Platform.OS === 'android' ? ' Also hides Tusky in recent apps and blocks screenshots.' : '')
      }
      value={enabled}
      disabled={busy}
      onChange={(next) => void change(next)}
    />
  );
}
