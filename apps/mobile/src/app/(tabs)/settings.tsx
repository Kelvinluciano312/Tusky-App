import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronRight, Landmark, Store, Tags, UserRound, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NameSheet } from '@/components/name-sheet';
import { Chips } from '@/components/ui/chips';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useConnectBank } from '@/lib/plaid';
import { type PlaidItem, useHerd, usePlaidItems, useProfile, useSetDisplayName } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { type Backend, backendLabel } from '@/lib/environment';
import { backend, realConfigured, supabase, switchBackend } from '@/lib/supabase';

export default function SettingsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile(session?.user.id);
  const { data: herd } = useHerd();
  const setName = useSetDisplayName();
  const [naming, setNaming] = useState(false);
  const { data: items = [] } = usePlaidItems();
  const { connectBank, isConnecting, error } = useConnectBank();

  const live = items.filter((item) => item.status !== 'archived');
  const archived = items.filter((item) => item.status === 'archived');

  const connectorName = (userId: string) =>
    herd?.members.find((m) => m.user_id === userId)?.display_name ?? 'A former member';

  const bankRow = (item: PlaidItem) => {
    const broken = item.status === 'login_required';
    // Only the member who connected a bank can repair it (Phase 9c).
    const mine = item.user_id === session?.user.id;
    return (
      <Pressable
        key={item.id}
        onPress={() => router.push({ pathname: '/bank/[id]', params: { id: item.id } })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          paddingVertical: Spacing.xs,
          backgroundColor: pressed ? colors.elevated : 'transparent',
        })}>
        <Landmark
          size={20}
          color={item.status === 'active' ? colors.brand : broken ? colors.negative : colors.textDim}
          strokeWidth={1.75}
        />
        <View style={{ flex: 1 }}>
          <AppText variant="label">{item.institution_name ?? 'Bank'}</AppText>
          {broken ? (
            <AppText variant="caption" tone="negative">
              {mine ? 'Sign-in expired' : `Sign-in expired · ${connectorName(item.user_id)} can reconnect`}
            </AppText>
          ) : item.status === 'archived' ? (
            <AppText variant="caption" tone="dim">
              History kept
            </AppText>
          ) : !mine ? (
            <AppText variant="caption" tone="dim">
              Connected by {connectorName(item.user_id)}
            </AppText>
          ) : null}
        </View>
        {broken && mine ? (
          /* Update mode: repairs this Item in place rather than creating a
             duplicate connection. */
          <Button
            title="Reconnect"
            variant="secondary"
            loading={isConnecting}
            onPress={() => connectBank(item.id)}
            style={{ paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md }}
          />
        ) : null}
        <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: insets.top + Spacing.md, gap: Spacing.lg }}>
      <AppText variant="display">Settings</AppText>

      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          You
        </AppText>
        <Pressable
          onPress={() => setNaming(true)}
          disabled={!profile}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <UserRound size={20} color={colors.brand} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <AppText variant="label">{profile?.display_name ?? ' '}</AppText>
            <AppText variant="caption" tone="dim">
              Your name in Tusky
            </AppText>
          </View>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/herd')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <Users size={20} color={colors.brand} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <AppText variant="label">{herd?.name ?? ' '}</AppText>
            <AppText variant="caption" tone="dim">
              {!herd || herd.members.length === 1
                ? 'Your herd · share Tusky with others'
                : herd.members.map((m) => m.display_name).join(', ')}
            </AppText>
          </View>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
      </Card>

      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Connections
        </AppText>

        {live.length === 0 && archived.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Landmark size={20} color={colors.textDim} strokeWidth={1.75} />
            <AppText tone="dim">No banks connected</AppText>
          </View>
        ) : (
          live.map(bankRow)
        )}

        {archived.length > 0 ? (
          <>
            <AppText variant="caption" tone="dim" style={{ marginTop: Spacing.sm }}>
              Disconnected
            </AppText>
            {archived.map(bankRow)}
          </>
        ) : null}

        {error && (
          <AppText variant="caption" tone="negative">
            {error}
          </AppText>
        )}

        <Button
          title={live.length === 0 ? 'Connect a bank' : 'Connect another bank'}
          variant="secondary"
          onPress={() => connectBank()}
          loading={isConnecting}
        />
      </Card>

      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Categories
        </AppText>
        <Pressable
          onPress={() => router.push('/categories')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <Tags size={20} color={colors.brand} strokeWidth={1.75} />
          <AppText variant="label" style={{ flex: 1 }}>
            Rename, hide or add categories
          </AppText>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/rules')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <Store size={20} color={colors.brand} strokeWidth={1.75} />
          <AppText variant="label" style={{ flex: 1 }}>
            Merchant rules and renames
          </AppText>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
      </Card>

      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section" tone="dim">
          Account
        </AppText>
        <AppText tone="dim">{session?.user.email}</AppText>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={async () => {
            await supabase.auth.signOut();
            // The next person to sign in on this device must never see this one's cached data.
            queryClient.clear();
          }}
        />
      </Card>

      {__DEV__ && realConfigured ? (
        /* Dev builds only: release builds are always real data. Each side
           keeps its own sign-in, so switching never signs you out. */
        <Card style={{ gap: Spacing.sm }}>
          <AppText variant="section" tone="dim">
            Data (dev build)
          </AppText>
          <Chips
            accessibilityLabel="Data source"
            options={[
              { value: 'sandbox' as Backend, label: 'Sandbox' },
              { value: 'real' as Backend, label: 'Real data' },
            ]}
            selected={backend}
            onSelect={(next) =>
              Alert.alert(
                next === 'real' ? 'Switch to real data?' : 'Switch to Sandbox?',
                next === 'real'
                  ? 'Tusky restarts on the production project, where banks are real. You sign in there separately.'
                  : 'Tusky restarts on the Sandbox project with its test banks.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Switch', onPress: () => switchBackend(next) },
                ],
              )
            }
          />
        </Card>
      ) : null}

      <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
        Tusky v0.1.0 · {backendLabel(backend)}
      </AppText>

      {profile ? (
        <NameSheet
          key={String(naming)}
          visible={naming}
          current={profile.display_name}
          isSaving={setName.isPending}
          onSave={(displayName) =>
            setName.mutate(
              { userId: profile.user_id, displayName },
              {
                onSuccess: () => setNaming(false),
                onError: (err) => Alert.alert('Could not save', err.message),
              },
            )
          }
          onClose={() => setNaming(false)}
        />
      ) : null}
    </ScrollView>
  );
}
