import { router } from 'expo-router';
import { HandCoins } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { transferLabel, useSettleUp } from '@/hooks/use-settle-up';
import { useTheme } from '@/hooks/use-theme';
import { useDeleteSettlement, useRecordSettlement } from '@/lib/queries';
import { lineTransfers, type Transfer } from '@/lib/settle';

/** How many of the lines behind the balance to list. */
const RECENT = 30;

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Settle up (Phase 11b): who owes whom across the herd, the payments that
 * would square it, the payments already recorded, and the purchases behind it.
 */
export default function SettleScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettleUp();
  const record = useRecordSettlement();
  const undo = useDeleteSettlement();
  const [paying, setPaying] = useState<Transfer | null>(null);

  if (!s.shared) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          icon={HandCoins}
          title="Nobody to settle with"
          message="Settle up works once someone joins your herd."
        />
      </View>
    );
  }

  const confirmUndo = (id: string, label: string) =>
    Alert.alert('Undo this payment?', `${label}. The balance goes back to what it was before it.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: () => undo.mutate(id, { onError: (err) => Alert.alert('Could not undo', err.message) }),
      },
    ]);

  const others = s.transfers.filter((t) => t.from !== s.me && t.to !== s.me);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }}>
      <Card style={{ alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg }}>
        {!s.ready ? (
          <ActivityIndicator color={colors.textDim} />
        ) : s.mine.length === 0 ? (
          <>
            <AppText variant="title">You&apos;re all square</AppText>
            <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
              {s.lines.length > 0 || s.settlements.length > 0
                ? 'Everything shared has been paid back.'
                : 'Mark a purchase Joint or split it, and who owes whom shows up here.'}
            </AppText>
          </>
        ) : (
          s.mine.map((t) => (
            <View key={`${t.from}-${t.to}`} style={{ alignItems: 'center', gap: Spacing.xs }}>
              <AppText variant="label" tone="dim">
                {transferLabel(t, s.me, s.name)}
              </AppText>
              <Amount value={t.amount} size={34} />
            </View>
          ))
        )}
      </Card>

      {s.error ? (
        <AppText variant="caption" tone="negative">
          Could not load balances: {s.error.message}
        </AppText>
      ) : null}

      {s.transfers.length > 0 ? (
        <Card style={{ gap: Spacing.sm }}>
          <AppText variant="section" tone="dim">
            To square up
          </AppText>
          {[...s.mine, ...others].map((t) => (
            <View key={`${t.from}-${t.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <AppText variant="label" style={{ flex: 1 }}>
                {s.name(t.from)} pays {s.name(t.to)}
              </AppText>
              <Amount value={t.amount} size={15} />
              <Button title="Record" variant="secondary" onPress={() => setPaying(t)} />
            </View>
          ))}
          <AppText variant="caption" tone="dim">
            Record a payment once the money has moved: Venmo, Zelle, cash.
          </AppText>
        </Card>
      ) : null}

      {s.settlements.length > 0 ? (
        <Card style={{ gap: Spacing.sm }}>
          <AppText variant="section" tone="dim">
            Payments
          </AppText>
          {s.settlements.map((p) => {
            const label = `${s.name(p.from_user)} paid ${s.name(p.to_user)}`;
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="label">{label}</AppText>
                  <AppText variant="caption" tone="dim">
                    {formatDate(p.date)}
                    {p.note ? ` · ${p.note}` : ''}
                  </AppText>
                </View>
                <Amount value={p.amount} size={15} />
                <Pressable onPress={() => confirmUndo(p.id, label)} hitSlop={8}>
                  <AppText variant="caption" tone="brand">
                    Undo
                  </AppText>
                </Pressable>
              </View>
            );
          })}
        </Card>
      ) : null}

      {s.lines.length > 0 ? (
        <Card style={{ gap: Spacing.sm }}>
          <AppText variant="section" tone="dim">
            Behind the balance
          </AppText>
          {s.lines.slice(0, RECENT).map((line) => {
            const [debt] = lineTransfers(line, s.members);
            const forWhom = line.split ? 'Split' : line.paid_by === null ? 'Joint' : `For ${s.name(line.paid_by)}`;
            const from = line.funded_by === null ? 'joint account' : `${s.name(line.funded_by)}'s account`;
            return (
              <Pressable
                key={line.id}
                onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: line.id } })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Spacing.sm,
                  paddingVertical: 2,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="label" numberOfLines={1}>
                    {line.merchant_name ?? line.name}
                  </AppText>
                  <AppText variant="caption" tone="dim" numberOfLines={1}>
                    {formatDate(line.date)} · {forWhom} · from {from}
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Amount value={line.amount} size={14} />
                  {debt ? (
                    <AppText variant="caption" tone="dim">
                      {s.name(debt.from)} → {s.name(debt.to)} <Amount value={debt.amount} size={11} />
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {s.lines.length > RECENT ? (
            <AppText variant="caption" tone="dim">
              And {s.lines.length - RECENT} older.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {paying ? (
        <RecordPaymentSheet
          transfer={paying}
          title={`${s.name(paying.from)} pays ${s.name(paying.to)}`}
          saving={record.isPending}
          onClose={() => setPaying(null)}
          onSave={(amount, note) =>
            record.mutate(
              { from_user: paying.from, to_user: paying.to, amount, note },
              {
                onSuccess: () => setPaying(null),
                onError: (err) => Alert.alert('Could not record it', err.message),
              },
            )
          }
        />
      ) : null}
    </ScrollView>
  );
}

function RecordPaymentSheet({
  transfer,
  title,
  saving,
  onSave,
  onClose,
}: {
  transfer: Transfer;
  title: string;
  saving: boolean;
  onSave: (amount: number, note: string | null) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(transfer.amount.toFixed(2));
  const [note, setNote] = useState('');
  const parsed = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <Sheet
      visible
      onClose={onClose}
      avoidKeyboard
      style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md, gap: Spacing.md }}>
      <AppText variant="title">{title}</AppText>
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
      <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Venmo, dinner week" maxLength={200} />
      <Button
        title="Record payment"
        disabled={!valid}
        loading={saving}
        onPress={() => onSave(Math.round(parsed * 100) / 100, note.trim() || null)}
      />
    </Sheet>
  );
}
