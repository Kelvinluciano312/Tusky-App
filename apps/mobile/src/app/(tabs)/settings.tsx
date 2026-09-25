import { router } from 'expo-router';
import { ChevronRight, Landmark, Store, Tags } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useConnectBank } from '@/lib/plaid';
import { type PlaidItem, usePlaidItems } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { data: items = [] } = usePlaidItems();
  const { connectBank, isConnecting, error } = useConnectBank();

  const live = items.filter((item) => item.status !== 'archived');
  const archived = items.filter((item) => item.status === 'archived');

  const bankRow = (item: PlaidItem) => {
    const broken = item.status === 'login_required';
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
              Sign-in expired
            </AppText>
          ) : item.status === 'archived' ? (
            <AppText variant="caption" tone="dim">
              History kept
            </AppText>
          ) : null}
        </View>
        {broken ? (
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
        <AppText>{session?.user.email}</AppText>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={async () => {
            await supabase.auth.signOut();
          }}
        />
      </Card>

      <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
        Tusky v0.1.0 · Plaid Sandbox
      </AppText>
    </ScrollView>
  );
}
