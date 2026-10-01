import { ChartPie, Landmark, ListChecks, Users } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PresetSheet } from '@/components/preset-sheet';
import { AiSwitch, CrowdSwitch } from '@/components/privacy-switches';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { nextStep, type OnboardingStep, previousStep, stepLabel } from '@/lib/first-run';
import { PLAN_NAMES, tierLines } from '@/lib/paywall';
import { useConnectBank } from '@/lib/plaid';
import type { PresetLine } from '@/lib/presets';
import { NAME_MAX, validatePersonName } from '@/lib/profile';
import {
  useFinishOnboarding,
  usePlaidItems,
  usePlan,
  usePlanLimits,
  useProfile,
  useReplaceBudgets,
  useSetDisplayName,
} from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * First run (Phase 15c): what Tusky does, your name, a bank, a budget, what
 * you share, and the plans. Every step past the name can be skipped; the
 * same things live in Settings and Budgets afterwards.
 */
export default function OnboardingScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const finish = useFinishOnboarding();

  const forward = () => {
    const next = nextStep(step);
    if (next) {
      setStep(next);
      return;
    }
    if (userId) {
      finish.mutate(userId, { onError: (err) => Alert.alert('Could not finish', err.message) });
    }
  };
  const back = previousStep(step);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          padding: Spacing.lg,
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.lg,
        }}>
        <AppText variant="caption" tone="dim">
          {stepLabel(step)}
        </AppText>
        {step === 'welcome' ? <Welcome onNext={forward} /> : null}
        {step === 'name' ? <NameStep userId={userId} onNext={forward} /> : null}
        {step === 'bank' ? <BankStep onNext={forward} /> : null}
        {step === 'budget' ? <BudgetStep onNext={forward} /> : null}
        {step === 'sharing' ? <SharingStep onNext={forward} /> : null}
        {step === 'plans' ? <PlansStep userId={userId} onNext={forward} finishing={finish.isPending} /> : null}
        {back ? <Button title="Back" variant="ghost" onPress={() => setStep(back)} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: Spacing.xs }}>
      <AppText style={{ fontFamily: Type.display, fontSize: 30, lineHeight: 38 }}>{title}</AppText>
      <AppText tone="dim">{body}</AppText>
    </View>
  );
}

function Point({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" tone="dim">
          {body}
        </AppText>
      </View>
    </View>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  const colors = useTheme();
  const icon = (I: typeof Landmark) => <I size={22} color={colors.brand} strokeWidth={1.75} />;
  return (
    <>
      <Heading title="Welcome to Tusky" body="Your money, in one place, for you and the people you share it with." />
      <Card style={{ gap: Spacing.md }}>
        <Point icon={icon(Landmark)} title="Every account together" body="Connect your banks and cards to see balances and spending side by side. Tusky only reads them; it can never move money." />
        <Point icon={icon(ListChecks)} title="Sorted for you" body="Transactions arrive categorized. Fix one and Tusky learns your way of sorting." />
        <Point icon={icon(ChartPie)} title="Budgets that fit" body="Build a budget from what you actually spend, then watch it through the month." />
        <Point icon={icon(Users)} title="Share with your herd" body="Invite a partner or family to see shared accounts and tag who spent what." />
      </Card>
      <Button title="Get started" onPress={onNext} />
    </>
  );
}

function NameStep({ userId, onNext }: { userId: string | undefined; onNext: () => void }) {
  const { data: profile } = useProfile(userId);
  const setName = useSetDisplayName();
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? profile?.display_name ?? '';
  const valid = validatePersonName(value);

  return (
    <>
      <Heading title="What should we call you?" body="Shown on Home, and to anyone you invite to your herd." />
      <TextField
        label="Your name"
        value={value}
        onChangeText={setTyped}
        maxLength={NAME_MAX}
        autoCapitalize="words"
        autoComplete="name"
      />
      <Button
        title="Continue"
        disabled={!valid || !userId}
        loading={setName.isPending}
        onPress={() => {
          if (!valid || !userId) return;
          if (valid === profile?.display_name) return onNext();
          setName.mutate(
            { userId, displayName: valid },
            { onSuccess: onNext, onError: (err) => Alert.alert('Could not save', err.message) },
          );
        }}
      />
    </>
  );
}

function BankStep({ onNext }: { onNext: () => void }) {
  const { data: items = [] } = usePlaidItems();
  const { connectBank, isConnecting, error } = useConnectBank();
  const live = items.filter((i) => i.status !== 'archived');

  return (
    <>
      <Heading
        title="Connect a bank"
        body="You sign in to your bank inside Plaid's secure screen. Tusky never sees your login, and it can only read your accounts."
      />
      {live.length > 0 ? (
        <Card style={{ gap: Spacing.xs }}>
          {live.map((i) => (
            <AppText key={i.id} variant="label">
              {i.institution_name ?? 'Bank'} connected
            </AppText>
          ))}
          <AppText variant="caption" tone="dim">
            Your history is on its way; it can take a minute or two to arrive.
          </AppText>
        </Card>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="negative">
          {error}
        </AppText>
      ) : null}
      <Button
        title={live.length > 0 ? 'Connect another bank' : 'Connect a bank'}
        variant={live.length > 0 ? 'secondary' : 'primary'}
        loading={isConnecting}
        onPress={() => void connectBank()}
      />
      <Button title={live.length > 0 ? 'Continue' : 'Skip for now'} variant={live.length > 0 ? 'primary' : 'ghost'} onPress={onNext} />
    </>
  );
}

function BudgetStep({ onNext }: { onNext: () => void }) {
  const replace = useReplaceBudgets();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const [done, setDone] = useState(false);

  const apply = (lines: PresetLine[]) =>
    replace.mutate(lines, {
      onSuccess: () => {
        setOpen(false);
        setDone(true);
      },
      onError: () => Alert.alert('Could not build the budget', 'Check your connection and try again.'),
    });

  return (
    <>
      <Heading
        title="Start a budget"
        body="Tusky can build one from your income and what you usually spend: match your habits, 50/30/20, or 70/20/10. You can change any line later in Budgets."
      />
      {done ? (
        <Card>
          <AppText variant="label">Budget saved. You&apos;ll find it in the Budgets tab.</AppText>
        </Card>
      ) : null}
      <Button
        title={done ? 'Build it again' : 'Build my budget'}
        variant={done ? 'secondary' : 'primary'}
        onPress={() => {
          setOpened((n) => n + 1);
          setOpen(true);
        }}
      />
      <Button title={done ? 'Continue' : 'Skip for now'} variant={done ? 'primary' : 'ghost'} onPress={onNext} />
      <PresetSheet key={opened} visible={open} isSaving={replace.isPending} onApply={apply} onClose={() => setOpen(false)} />
    </>
  );
}

function SharingStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Heading
        title="Help Tusky get smarter"
        body="Both are yours to change any time in Settings, under Account & privacy."
      />
      <Card style={{ gap: Spacing.md }}>
        <CrowdSwitch />
        <AiSwitch />
      </Card>
      <Button title="Continue" onPress={onNext} />
    </>
  );
}

function PlansStep({ userId, onNext, finishing }: { userId: string | undefined; onNext: () => void; finishing: boolean }) {
  const { data: plan } = usePlan(userId);
  const { data: limits = [] } = usePlanLimits();
  const trialEnds = plan?.plan === 'trial' && plan.expires_at ? new Date(plan.expires_at) : null;

  return (
    <>
      <Heading
        title={trialEnds ? 'Your free trial' : 'Plans'}
        body={
          trialEnds
            ? `Everything is open until ${trialEnds.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}. Then pick a plan to keep your banks connected. Your history always stays.`
            : 'Every plan opens every feature. They differ in how many banks stay connected. Your history always stays.'
        }
      />
      {limits
        .filter((l) => l.id in PLAN_NAMES && l.id !== 'free' && l.id !== 'trial')
        .map((l) => (
          <Card key={l.id} style={{ gap: 2 }}>
            <AppText variant="label">{PLAN_NAMES[l.id]}</AppText>
            {tierLines(l).map((line) => (
              <AppText key={line} variant="caption" tone="dim">
                {line}
              </AppText>
            ))}
          </Card>
        ))}
      <AppText variant="caption" tone="dim">
        See prices and choose a plan any time in Settings, under Plan.
      </AppText>
      <Button title="Start using Tusky" loading={finishing} onPress={onNext} />
    </>
  );
}
