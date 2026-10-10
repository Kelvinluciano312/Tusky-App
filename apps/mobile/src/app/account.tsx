import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, KeyRound, LogOut } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView } from 'react-native';
import { dialog } from '@/components/ui/dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeleteAccountSheet } from '@/components/delete-account-sheet';
import { PasswordSheet } from '@/components/password-sheet';
import { AiSwitch, CrowdSwitch, TwoFactorSwitch } from '@/components/privacy-switches';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { DELETE_URL, PRIVACY_URL, TERMS_URL } from '@/constants/legal';
import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteProofKind, hasProvider } from '@/lib/apple';
import { confirmWithApple } from '@/lib/apple-auth';
import { deleteWarning } from '@/lib/paywall';
import { type DeleteAccountProof, useDeleteAccount, useIdentities, usePlan } from '@/lib/queries';
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
  const { data: identities } = useIdentities(session?.user.id);
  // Until the identities load, assume the common case so an email user never sees "Set a password".
  const hasPassword = !identities || hasProvider(identities, 'email');
  const deleteAccount = useDeleteAccount();
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    void queryClient.invalidateQueries({ queryKey: ['identities'] });
    dialog.alert('Password changed', 'Use the new one next time you sign in.');
  };

  const warning = plan ? deleteWarning(plan, new Date()) : null;

  // An Apple-only account on iOS has no password: Apple asks again, which also lets the server revoke its grant.
  const proofKind = deleteProofKind(identities, Platform.OS);

  // The sheet shows the failure inline (a wrong password most often).
  const doDelete = async (password: string | null) => {
    let proof: DeleteAccountProof;
    if (proofKind === 'apple') {
      try {
        const confirmed = await confirmWithApple();
        if (!confirmed) return;
        proof = { apple: confirmed };
      } catch {
        dialog.alert('Apple did not answer', 'Nothing was deleted. Try again.');
        return;
      }
    } else {
      proof = { password: password ?? '' };
    }
    deleteAccount.mutate(proof, {
      onSuccess: async () => {
        setDeleting(false);
        await supabase.auth.signOut();
        queryClient.clear();
      },
    });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ ...Layout.column, padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Sign-in
        </AppText>
        <AppText tone="dim">{email}</AppText>
        {hasProvider(identities, 'apple') ? <AppText tone="dim">Signed in with Apple</AppText> : null}
        <Row icon={<KeyRound size={20} color={colors.brand} strokeWidth={1.75} />} label={hasPassword ? 'Change password' : 'Set a password'} onPress={() => {
          setPasswordError(null);
          setChanging(true);
        }} />
        <TwoFactorSwitch />
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
        onPress={() => {
          deleteAccount.reset();
          setDeleting(true);
        }}
        style={{ alignSelf: 'center', padding: Spacing.sm, marginTop: Spacing.lg }}>
        <AppText variant="caption" tone="dim" style={{ textDecorationLine: 'underline' }}>
          Delete my account
        </AppText>
      </Pressable>

      <DeleteAccountSheet
        key={`delete-${deleting}`}
        visible={deleting}
        warning={warning}
        proof={proofKind}
        isDeleting={deleteAccount.isPending}
        error={deleteAccount.error?.message ?? null}
        onDelete={(password) => void doDelete(password)}
        onClose={() => setDeleting(false)}
      />

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
