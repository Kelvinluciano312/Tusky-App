import { Alert, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Chips } from '@/components/ui/chips';
import { Spacing } from '@/constants/theme';
import { payerLabel } from '@/lib/herd';
import { type Herd, type Transaction, useHerd, useSetPaidBy } from '@/lib/queries';

/** Each member by first name, then Joint (null). */
export function memberChips(herd: Herd) {
  return [
    ...herd.members.map((m) => ({ value: m.user_id as string | null, label: payerLabel(m.user_id, herd.members) })),
    { value: null as string | null, label: 'Joint' },
  ];
}

/**
 * Who paid for one transaction (Phase 9d). Nothing to choose in a herd of one,
 * so it renders nothing there.
 */
export function WhoPaid({ transaction }: { transaction: Pick<Transaction, 'id' | 'paid_by' | 'paid_by_is_manual'> }) {
  const { data: herd } = useHerd();
  const setPaidBy = useSetPaidBy();
  if (!herd || herd.members.length < 2) return null;

  const options = memberChips(herd);
  // A payer who has left the herd still shows, so the row never looks unset.
  if (transaction.paid_by !== null && !herd.members.some((m) => m.user_id === transaction.paid_by)) {
    options.push({ value: transaction.paid_by, label: 'Former member' });
  }

  return (
    <View style={{ gap: Spacing.sm, paddingVertical: Spacing.sm + 2 }}>
      <AppText variant="label" tone="dim">
        Who paid
      </AppText>
      <Chips
        accessibilityLabel="Who paid"
        options={options}
        selected={transaction.paid_by}
        onSelect={(paidBy) =>
          setPaidBy.mutate(
            { transactionId: transaction.id, paidBy },
            { onError: (err) => Alert.alert('Could not save', err.message) },
          )
        }
      />
      {transaction.paid_by_is_manual ? null : (
        <AppText variant="caption" tone="dim">
          From whose account it is. Tap to change just this one.
        </AppText>
      )}
    </View>
  );
}
