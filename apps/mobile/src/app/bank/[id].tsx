import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Landmark } from 'lucide-react-native';
import { Alert, ScrollView, Switch, View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useConnectBank, useDisconnectBank, useSandboxTools } from '@/lib/plaid';
import { Chips } from '@/components/ui/chips';
import { memberChips } from '@/components/who-paid';
import {
  useHerd,
  useItemAccounts,
  usePlaidItems,
  useSetAccountHidden,
  useSetAccountOwner,
  useSetAccountPrivate,
} from '@/lib/queries';
import { useSession } from '@/lib/session';

function connectedOn(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * One bank: its accounts with a show/hide switch each — the only place hidden
 * accounts are listed, so the only place they can be unhidden — and the way
 * to disconnect it. In a herd (Phase 9c), only the member who connected the
 * bank can make its accounts private, reconnect it or disconnect it.
 */
export default function BankScreen() {
  const colors = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { data: items = [], isLoading } = usePlaidItems();
  const { data: accounts = [] } = useItemAccounts(id);
  const { data: herd } = useHerd();
  const setHidden = useSetAccountHidden();
  const setPrivate = useSetAccountPrivate();
  const setOwner = useSetAccountOwner();
  const { disconnect, isDisconnecting, error: disconnectError } = useDisconnectBank();
  const { connectBank, isConnecting, error: connectError } = useConnectBank();
  const { resetLogin, fireWebhook, isBusy } = useSandboxTools();

  const item = items.find((i) => i.id === id);

  // Deleted meanwhile, or a stale link: say so rather than render an empty bank.
  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {isLoading ? null : (
          <EmptyState
            icon={Landmark}
            title="This bank is no longer connected"
            message="Connect it again from Settings to bring it back."
          />
        )}
      </View>
    );
  }

  const name = item.institution_name ?? 'Bank';
  const archived = item.status === 'archived';
  const mine = item.user_id === session?.user.id;
  const connector = herd?.members.find((m) => m.user_id === item.user_id)?.display_name ?? 'The member who connected it';
  const error = disconnectError ?? connectError;
  const n = accounts.length;
  const loss = `Deletes its ${n} account${n === 1 ? '' : 's'} and all their transactions. This can't be undone.`;

  const run = async (mode: 'archive' | 'delete') => {
    if (await disconnect(item.id, mode)) router.back();
  };

  const confirmDisconnect = () =>
    Alert.alert(`Disconnect ${name}?`, 'Tusky stops syncing it and removes the connection at Plaid.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        // Asked twice, and the second time names the loss.
        onPress: () =>
          Alert.alert('Delete everything?', loss, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete everything', style: 'destructive', onPress: () => run('delete') },
          ]),
      },
      // Last, so it is Android's positive button: the safe choice is the default.
      { text: 'Keep history', onPress: () => run('archive') },
    ]);

  const confirmDeleteHistory = () =>
    Alert.alert(`Delete ${name}'s history?`, loss, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete history', style: 'destructive', onPress: () => run('delete') },
    ]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, gap: Spacing.lg }}>
      <Stack.Title>{name}</Stack.Title>

      <Card style={{ gap: Spacing.sm }}>
        <AppText tone={item.status === 'login_required' ? 'negative' : 'dim'}>
          {item.status === 'active'
            ? `Syncing automatically · connected ${connectedOn(item.created_at)}`
            : item.status === 'login_required'
              ? 'Sign-in expired'
              : 'Disconnected · history kept'}
        </AppText>
        {mine ? null : (
          <AppText variant="caption" tone="dim">
            Connected by {connector}. Only they can reconnect or disconnect it.
          </AppText>
        )}
        {item.status === 'login_required' && mine ? (
          /* Update mode: repairs this Item in place rather than creating a
             duplicate connection. */
          <Button
            title="Reconnect"
            variant="secondary"
            loading={isConnecting}
            onPress={() => connectBank(item.id)}
          />
        ) : null}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs }}>
          <AppText variant="section" tone="dim">
            Accounts
          </AppText>
          <AppText variant="caption" tone="dim">
            Show in Tusky
          </AppText>
        </View>
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            // Faded when not counted: hidden, or on a disconnected bank.
            dimmed={archived || account.hidden}
            trailing={
              <Switch
                value={!account.hidden}
                accessibilityLabel={`Show ${account.name} in Tusky`}
                trackColor={{ false: colors.elevated, true: colors.brand }}
                onValueChange={(show) =>
                  setHidden.mutate({ accountId: account.id, itemId: item.id, hidden: !show })
                }
              />
            }
          />
        ))}
        <AppText variant="caption" tone="dim" style={{ marginTop: Spacing.sm }}>
          Hidden accounts leave net worth, transactions, budgets, reports and bills. Nothing is deleted.
        </AppText>
      </Card>

      {herd && herd.members.length > 1 ? (
        /* Who paid (9d): an account's owner is the default payer of its
           transactions. Any member may set it. */
        <Card style={{ gap: Spacing.xs }}>
          <AppText variant="section" tone="dim">
            Whose account?
          </AppText>
          {accounts.map((account) => (
            <View
              key={account.id}
              style={{
                gap: Spacing.sm,
                paddingVertical: Spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}>
              <AppText variant="label">{account.name}</AppText>
              <Chips
                accessibilityLabel={`Whose account is ${account.name}`}
                options={memberChips(herd)}
                selected={account.owner_id}
                onSelect={(ownerId) => setOwner.mutate({ accountId: account.id, itemId: item.id, ownerId })}
              />
            </View>
          ))}
          <AppText variant="caption" tone="dim" style={{ marginTop: Spacing.xs }}>
            Its transactions count as paid by its owner, unless you change one by hand.
          </AppText>
        </Card>
      ) : null}

      {mine ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs }}>
            <AppText variant="section" tone="dim">
              Who sees it
            </AppText>
            <AppText variant="caption" tone="dim">
              Private
            </AppText>
          </View>
          {accounts.map((account) => (
            <View
              key={account.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: Spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}>
              <View style={{ flex: 1 }}>
                <AppText variant="label">{account.name}</AppText>
                <AppText variant="caption" tone="dim">
                  {account.is_private ? 'Only you' : 'Everyone in your herd'}
                </AppText>
              </View>
              <Switch
                value={account.is_private}
                accessibilityLabel={`Keep ${account.name} private`}
                trackColor={{ false: colors.elevated, true: colors.brand }}
                onValueChange={(isPrivate) =>
                  setPrivate.mutate({ accountId: account.id, itemId: item.id, isPrivate })
                }
              />
            </View>
          ))}
          <AppText variant="caption" tone="dim" style={{ marginTop: Spacing.sm }}>
            A private account, with its transactions and balances, is visible to you alone.
          </AppText>
        </Card>
      ) : null}

      {__DEV__ && !archived && mine ? (
        /* Dev builds only — never ships. Break forces a real
           ITEM_LOGIN_REQUIRED (reconnect path); Webhook makes Plaid fire
           SYNC_UPDATES_AVAILABLE (webhook sync path). */
        <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
          <Button title="Webhook (dev)" variant="ghost" loading={isBusy} onPress={() => fireWebhook(item.id)} />
          <Button title="Break (dev)" variant="ghost" loading={isBusy} onPress={() => resetLogin(item.id)} />
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" tone="negative">
          {error}
        </AppText>
      ) : null}

      {!mine ? null : archived ? (
        <Button title="Delete history" variant="secondary" loading={isDisconnecting} onPress={confirmDeleteHistory} />
      ) : (
        <Button title="Disconnect bank" variant="secondary" loading={isDisconnecting} onPress={confirmDisconnect} />
      )}
    </ScrollView>
  );
}
