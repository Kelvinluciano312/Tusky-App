import { router } from 'expo-router';
import { ChevronRight, HandCoins, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NameSheet } from '@/components/name-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { transferLabel, useSettleUp } from '@/hooks/use-settle-up';
import { useTheme } from '@/hooks/use-theme';
import { expiresIn, formatCode, initials, inviteMessage } from '@/lib/herd';
import {
  type HerdMember,
  useCreateInvite,
  useHerd,
  useHerdInvites,
  useLeaveHerd,
  useRemoveMember,
  useRenameHerd,
  useRevokeInvite,
} from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Your herd: the people you share Tusky with. The owner renames it, invites by
 * code and removes members; anyone can leave, taking the banks they connected.
 */
export default function HerdScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const me = session?.user.id;
  const { data: herd } = useHerd();
  const { data: invites = [] } = useHerdInvites();
  const rename = useRenameHerd();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const leave = useLeaveHerd();
  const remove = useRemoveMember();
  const [naming, setNaming] = useState(false);
  const settle = useSettleUp();

  if (!herd) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const isOwner = herd.members.some((m) => m.user_id === me && m.role === 'owner');
  const owner = herd.members.find((m) => m.role === 'owner');
  const alone = herd.members.length === 1;
  const failed = (title: string) => (err: Error) => Alert.alert(title, err.message);

  const share = (code: string) => Share.share({ message: inviteMessage(herd.name, code) });

  const invite = () =>
    createInvite.mutate(undefined, {
      onSuccess: (created) => share(created.code),
      onError: failed('Could not create an invite'),
    });

  const openInvite = (code: string) =>
    Alert.alert(formatCode(code), 'Anyone with this code can join your herd until it expires or is used.', [
      { text: 'Close', style: 'cancel' },
      {
        text: 'Cancel invite',
        style: 'destructive',
        onPress: () => revokeInvite.mutate(code, { onError: failed('Could not cancel the invite') }),
      },
      { text: 'Share', onPress: () => share(code) },
    ]);

  const confirmRemove = (member: HerdMember) =>
    Alert.alert(
      `Remove ${member.display_name}?`,
      'The banks they connected leave with them. Budgets, categories and rules stay with the herd.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => remove.mutate(member.user_id, { onError: failed('Could not remove them') }),
        },
      ],
    );

  // Leaving doesn't carry a balance with it (11b), so say it first.
  const balanceNote = settle.mine
    .map((t) => `${transferLabel(t, me ?? null, settle.name)} $${t.amount.toFixed(2)}.`)
    .join(' ');
  const confirmLeave = () =>
    Alert.alert(
      `Leave ${herd.name}?`,
      "The banks you connected leave with you, into a new herd of your own. This herd keeps its budgets, categories and rules." +
        (balanceNote ? `\n\n${balanceNote} Settle up first: balances don't follow you out.` : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => leave.mutate(undefined, { onSuccess: () => router.back(), onError: failed('Could not leave') }),
        },
      ],
    );

  const memberRow = (member: HerdMember) => {
    const isMe = member.user_id === me;
    const removable = isOwner && !isMe;
    return (
      <Pressable
        key={member.user_id}
        disabled={!removable}
        onPress={() => confirmRemove(member)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm + 2,
          paddingVertical: Spacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppText variant="label" tone="brand">
            {initials(member.display_name)}
          </AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="label">
            {member.display_name}
            {isMe ? ' (you)' : ''}
          </AppText>
          <AppText variant="caption" tone="dim">
            {member.role === 'owner' ? 'Owner' : 'Member'}
          </AppText>
        </View>
        {removable ? (
          <AppText variant="caption" tone="dim">
            Remove
          </AppText>
        ) : null}
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }}>
      <Pressable
        disabled={!isOwner}
        onPress={() => setNaming(true)}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="title">{herd.name}</AppText>
            <AppText variant="caption" tone="dim">
              {alone ? 'Just you so far' : `${herd.members.length} members`}
              {isOwner ? ' · tap to rename' : ''}
            </AppText>
          </View>
          {isOwner ? <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} /> : null}
        </Card>
      </Pressable>

      {alone ? (
        <AppText variant="caption" tone="dim">
          Share Tusky with a partner or family. Everyone in a herd sees its accounts, budgets, categories and rules,
          except the accounts someone keeps private.
        </AppText>
      ) : null}

      <Card style={{ paddingVertical: Spacing.xs }}>{herd.members.map(memberRow)}</Card>

      {alone ? null : (
        <Pressable onPress={() => router.push('/settle')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <HandCoins size={20} color={colors.brand} strokeWidth={1.75} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">Settle up</AppText>
              <AppText variant="caption" tone="dim">
                {settle.mine.length > 0
                  ? settle.mine.map((t) => (
                      <AppText key={`${t.from}-${t.to}`} variant="caption" tone="dim">
                        {transferLabel(t, me ?? null, settle.name)} <Amount value={t.amount} size={12} />{' '}
                      </AppText>
                    ))
                  : "You're all square"}
              </AppText>
            </View>
            <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
          </Card>
        </Pressable>
      )}

      {isOwner ? (
        <Card style={{ gap: Spacing.sm }}>
          <AppText variant="section" tone="dim">
            Invites
          </AppText>
          {invites.map((inv) => (
            <Pressable
              key={inv.code}
              onPress={() => openInvite(inv.code)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.sm,
                paddingVertical: Spacing.xs,
                opacity: pressed ? 0.7 : 1,
              })}>
              <AppText style={{ fontFamily: Type.mono, flex: 1 }}>{formatCode(inv.code)}</AppText>
              <AppText variant="caption" tone="dim">
                Expires {expiresIn(inv.expires_at)}
              </AppText>
              <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
            </Pressable>
          ))}
          <Button
            title="Invite someone"
            variant="secondary"
            loading={createInvite.isPending}
            onPress={invite}
          />
          <View style={{ flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' }}>
            <UserPlus size={14} color={colors.textDim} strokeWidth={1.75} />
            <AppText variant="caption" tone="dim" style={{ flex: 1 }}>
              Each code works once, for 7 days. Up to 6 people per herd.
            </AppText>
          </View>
        </Card>
      ) : (
        <AppText variant="caption" tone="dim">
          Only {owner?.display_name ?? 'the owner'} can invite people.
        </AppText>
      )}

      {alone ? (
        <Button title="Join someone else's herd" variant="secondary" onPress={() => router.push('/join-herd')} />
      ) : (
        <Button title="Leave herd" variant="ghost" loading={leave.isPending} onPress={confirmLeave} />
      )}

      <NameSheet
        key={String(naming)}
        visible={naming}
        current={herd.name}
        title="Herd name"
        caption="Everyone in the herd sees it."
        isSaving={rename.isPending}
        onSave={(name) =>
          rename.mutate(
            { herdId: herd.id, name },
            { onSuccess: () => setNaming(false), onError: failed('Could not rename the herd') },
          )
        }
        onClose={() => setNaming(false)}
      />
    </ScrollView>
  );
}
