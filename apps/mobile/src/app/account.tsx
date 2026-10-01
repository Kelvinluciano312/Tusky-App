import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, KeyRound, LogOut } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasswordSheet } from '@/components/password-sheet';
import { AiSwitch, CrowdSwitch } from '@/components/privacy-switches';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { DELETE_URL, PRIVACY_URL, TERMS_URL } from '@/constants/legal';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteWarning } from '@/lib/paywall';
import { manageSubscriptionsUrl } from '@/lib/purchases';
import { useDeleteAccount, usePlan } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Account & privacy (Phase 15f): the things you set once and rarely revisit,
 * kept off the main Settings screen. Deleting the account is the last, quiet
 * line here: findable, as the stores require, but never in the way.
 */
export default function AccountScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const email = session?.user.email ?? '';
  const { data: plan } = usePlan(session?.user.id);
  const deleteAccount = useDeleteAccount();
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const signOut = async () => {
    await supabase.auth.signOut();
    // The next person to sign in on this device must never see this one's cached data.
    queryClient.clear();
  };

  const savePassword = async (password: string) => {
    setSaving(true);
    setPasswordError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setPasswordError(error.message);
      return;
    }
    setChanging(false);
    Alert.alert('Password changed', 'Use the new one next time you sign in.');
  };

  const confirmDelete = () => {
    const confirm = () =>
      Alert.alert(
        'Delete your account?',
        'Tusky disconnects your banks and deletes everything you have tracked. If you share a herd, it keeps what belongs to the herd. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              deleteAccount.mutate(undefined, {
                onSuccess: async () => {
                  await supabase.auth.signOut();
                  queryClient.clear();
                },
                onError: (err) => Alert.alert('Could not delete your account', err.message),
              }),
          },
        ],
      );
    const warning = plan ? deleteWarning(plan, new Date()) : null;
    if (!warning) return confirm();
    Alert.alert('Cancel your subscription first', warning, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Manage subscription', onPress: async () => Linking.openURL(await manageSubscriptionsUrl()) },
      { text: 'Delete anyway', style: 'destructive', onPress: confirm },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Sign-in
        </AppText>
        <AppText tone="dim">{email}</AppText>
        <Row icon={<KeyRound size={20} color={colors.brand} strokeWidth={1.75} />} label="Change password" onPress={() => {
          setPasswordError(null);
          setChanging(true);
        }} />
        <Row icon={<LogOut size={20} color={colors.brand} strokeWidth={1.75} />} label="Sign out" onPress={() => void signOut()} />
      </Card>

      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Privacy and AI
        </AppText>
        <AiSwitch />
        <CrowdSwitch />
      </Card>

      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="section" tone="dim">
          Legal
        </AppText>
        {[
          { label: 'Terms of Service', url: TERMS_URL },
          { label: 'Privacy Policy', url: PRIVACY_URL },
          { label: 'How deletion works', url: DELETE_URL },
        ].map((l) => (
          <Pressable key={l.label} accessibilityRole="link" onPress={() => void Linking.openURL(l.url)} style={{ paddingVertical: Spacing.xs }}>
            <AppText tone="brand">{l.label}</AppText>
          </Pressable>
        ))}
      </Card>

      <Pressable
        accessibilityRole="button"
        disabled={deleteAccount.isPending}
        onPress={confirmDelete}
        style={{ alignSelf: 'center', padding: Spacing.sm, marginTop: Spacing.lg }}>
        <AppText variant="caption" tone="dim" style={{ textDecorationLine: 'underline' }}>
          {deleteAccount.isPending ? 'Deleting…' : 'Delete my account'}
        </AppText>
      </Pressable>

      <PasswordSheet
        key={String(changing)}
        visible={changing}
        email={email}
        isSaving={saving}
        error={passwordError}
        onSave={(pw) => void savePassword(pw)}
        onClose={() => setChanging(false)}
      />
    </ScrollView>
  );
}

function Row({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.xs,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      {icon}
      <AppText variant="label" style={{ flex: 1 }}>
        {label}
      </AppText>
      <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
    </Pressable>
  );
}
