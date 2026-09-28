import { router, useLocalSearchParams } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRow } from '@/components/account-row';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeCode } from '@/lib/herd';
import { useAccounts, useInvitePreview, useJoinHerd } from '@/lib/queries';

/**
 * One invite, from a typed code or a tusky:///join/<code> link: who invited
 * you to which herd, which of your accounts to share, then join. Everything
 * you have moves into the herd; the herd's own settings win where both of you
 * set the same thing.
 */
export default function JoinInviteScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(raw ?? '');
  const { data: preview, error, isLoading } = useInvitePreview(code);
  const { data: accounts = [] } = useAccounts();
  const join = useJoinHerd();
  // Accounts to keep private, seeded from the ones already private.
  const [kept, setKept] = useState<Set<string> | null>(null);
  const privateIds = kept ?? new Set(accounts.filter((a) => a.is_private).map((a) => a.id));

  const toggle = (id: string, share: boolean) => {
    const next = new Set(privateIds);
    if (share) next.delete(id);
    else next.add(id);
    setKept(next);
  };

  if (!code || error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          icon={Users}
          title="This invite doesn't work"
          message={error?.message ?? "That code doesn't look right. Check it and try again."}
        />
      </View>
    );
  }
  if (isLoading || !preview) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const submit = () =>
    join.mutate(
      { code, privateAccountIds: [...privateIds] },
      {
        onSuccess: ({ hidden_account_ids }) => {
          router.replace('/herd');
          const n = hidden_account_ids.length;
          if (n > 0) {
            Alert.alert(
              'Some accounts were already here',
              `${n} of your accounts ${n === 1 ? 'is' : 'are'} already in ${preview.herd_name} through someone else's connection, so yours ${n === 1 ? 'is' : 'are'} hidden to avoid counting ${n === 1 ? 'it' : 'them'} twice. You can disconnect your copy of that bank in Settings.`,
            );
          }
        },
        onError: (err) => Alert.alert('Could not join', err.message),
      },
    );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }}>
      <View style={{ gap: Spacing.xs }}>
        <AppText variant="display">{preview.herd_name}</AppText>
        <AppText tone="dim">
          {preview.inviter_name} invited you · {preview.member_count} {preview.member_count === 1 ? 'member' : 'members'}
        </AppText>
      </View>

      {preview.blocked ? (
        <Card>
          <AppText>{preview.blocked}</AppText>
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs }}>
              <AppText variant="section" tone="dim">
                Your accounts
              </AppText>
              <AppText variant="caption" tone="dim">
                Share
              </AppText>
            </View>
            {accounts.length === 0 ? (
              <AppText tone="dim">No banks connected yet.</AppText>
            ) : (
              accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  trailing={
                    <Switch
                      value={!privateIds.has(account.id)}
                      accessibilityLabel={`Share ${account.name} with the herd`}
                      trackColor={{ false: colors.elevated, true: colors.brand }}
                      onValueChange={(share) => toggle(account.id, share)}
                    />
                  }
                />
              ))
            )}
            <AppText variant="caption" tone="dim" style={{ marginTop: Spacing.sm }}>
              Accounts you don&apos;t share stay visible to you alone. You can change this later on each bank&apos;s
              page.
            </AppText>
          </Card>

          <AppText variant="caption" tone="dim">
            Your categories, rules and budgets come with you. Where the herd already set the same thing, the
            herd&apos;s version wins, and your budgets move only if the herd has none yet.
          </AppText>

          <Button title={`Join ${preview.herd_name}`} loading={join.isPending} onPress={submit} />
        </>
      )}
    </ScrollView>
  );
}
