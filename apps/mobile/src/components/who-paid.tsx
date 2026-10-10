import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';

import { SplitSheet } from '@/components/split-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Chips } from '@/components/ui/chips';
import { Spacing } from '@/constants/theme';
import { transferLabel } from '@/hooks/use-settle-up';
import { isShared, payerLabel } from '@/lib/herd';
import { type Herd, type TransactionDetail, useCategories, useHerd, useSetPaidBy } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { lineTransfers } from '@/lib/settle';

/** Each member by first name, then Joint (null). */
export function memberChips(herd: Herd) {
  return [
    ...herd.members.map((m) => ({ value: m.user_id as string | null, label: payerLabel(m.user_id, herd.members) })),
    { value: null as string | null, label: 'Joint' },
  ];
}

type Choice = string | null | 'split';

/**
 * Who spent this (15d; `paid_by`): a member or Joint, a tag that organizes a
 * joint account and never makes a debt by itself. A custom split is the one
 * thing that does: then it says who owes whom. Nothing to choose in a herd of
 * one, so it renders nothing there.
 */
export function WhoPaid({
  transaction: t,
}: {
  transaction: Pick<
    TransactionDetail,
    'id' | 'date' | 'amount' | 'pending' | 'category_id' | 'paid_by' | 'paid_by_is_manual' | 'split' | 'split_suggested' | 'accounts'
  >;
}) {
  const { data: herd } = useHerd();
  const { data: categories = [] } = useCategories();
  const { session } = useSession();
  const setPaidBy = useSetPaidBy();
  const [splitting, setSplitting] = useState(false);
  if (!herd || !isShared(herd)) return null;

  const members = herd.members;
  const me = session?.user.id ?? null;
  const save = (paidBy: string | null, split: Record<string, number> | null = null) =>
    setPaidBy.mutate(
      { transactionId: t.id, paidBy, split },
      { onError: (err) => dialog.alert('Could not save', err.message) },
    );

  const options: { value: Choice; label: string }[] = memberChips(herd);
  // Someone who has left still shows, so the row never looks unset.
  if (t.paid_by !== null && !members.some((m) => m.user_id === t.paid_by)) {
    options.push({ value: t.paid_by, label: 'Former member' });
  }
  options.push({ value: 'split', label: 'Split cost…' });

  const owner = t.accounts?.owner_id ?? null;
  const paidFrom = owner === null ? 'Paid from a joint account' : `Paid from ${payerLabel(owner, members)}'s account`;
  const kind = categories.find((c) => c.id === t.category_id)?.kind ?? 'expense';
  const isPrivate = t.accounts?.is_private ?? false;
  // The same rows as the shared_lines view: posted, split expenses on shared, shown accounts.
  const counts = !!t.split && !t.pending && !isPrivate && !(t.accounts?.hidden ?? false) && kind === 'expense';
  const debt = counts
    ? lineTransfers({ id: t.id, date: t.date, amount: t.amount, funded_by: owner, paid_by: t.paid_by, split: t.split }, members)
    : [];

  return (
    <View style={{ gap: Spacing.sm, paddingVertical: Spacing.sm + 2 }}>
      <AppText variant="label" tone="dim">
        Spent by
      </AppText>
      <Chips<Choice>
        accessibilityLabel="Who spent it"
        options={options}
        selected={t.split ? 'split' : t.paid_by}
        onSelect={(choice) => (choice === 'split' ? setSplitting(true) : save(choice))}
      />
      {t.split ? (
        <Pressable onPress={() => setSplitting(true)} hitSlop={6}>
          <AppText variant="caption" tone="brand">
            {Object.entries(t.split)
              .map(([id, pct]) => `${payerLabel(id, members)} ${pct}%`)
              .join(' · ')}
            {' · Edit'}
          </AppText>
        </Pressable>
      ) : null}
      {!t.split && !t.paid_by_is_manual && t.split_suggested ? (
        // Jev's hint (12d). It opens the same sheet and writes nothing itself.
        <Pressable onPress={() => setSplitting(true)} hitSlop={6}>
          <AppText variant="caption" tone="brand">
            Looks shared. Split it?
          </AppText>
        </Pressable>
      ) : null}
      <AppText variant="caption" tone="dim">
        {paidFrom}
        {debt.map((d) => (
          <AppText key={`${d.from}-${d.to}`} variant="caption" tone="dim">
            {` · ${transferLabel(d, me, (id) => payerLabel(id, members))} `}
            <Amount value={d.amount} size={12} />
          </AppText>
        ))}
      </AppText>
      {isPrivate && t.split ? (
        <AppText variant="caption" tone="dim">
          Private accounts don&apos;t count toward settle-up.
        </AppText>
      ) : null}

      {splitting ? (
        <SplitSheet
          visible
          members={members}
          total={Math.abs(t.amount)}
          current={t.split}
          onClose={() => setSplitting(false)}
          onSave={(split) => {
            setSplitting(false);
            save(null, split);
          }}
        />
      ) : null}
    </View>
  );
}
