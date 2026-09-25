import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/category-picker';
import { CategorySheet, type SheetTarget } from '@/components/category-sheet';
import { DetailLine as Line } from '@/components/detail-line';
import { NoteSheet } from '@/components/note-sheet';
import { RenameSheet } from '@/components/rename-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useCategoryChoice } from '@/hooks/use-category-choice';
import { useTheme } from '@/hooks/use-theme';
import { transactionName } from '@/lib/merchants';
import {
  type Category,
  useCategories,
  useMerchantRules,
  useSetMerchantRule,
  useSetTransactionNotes,
  useTransaction,
} from '@/lib/queries';

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** One transaction: rename its merchant, recategorize it (once or always), and see where it came from. */
export default function TransactionScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, error } = useTransaction(id);
  const { data: categories = [] } = useCategories();
  const { data: rules = new Map() } = useMerchantRules();
  const chooseCategory = useCategoryChoice();
  const setRule = useSetMerchantRule();
  const setNotes = useSetTransactionNotes();
  const [picking, setPicking] = useState(false);
  const [addTarget, setAddTarget] = useState<SheetTarget | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [noting, setNoting] = useState(false);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.md }}>
        {error ? <AppText tone="negative">Could not load this transaction.</AppText> : null}
      </View>
    );
  }

  const name = transactionName(t, rules);
  const original = t.merchant_name ?? t.name;
  // A name with no letters has an empty key and can take no rule or rename.
  const merchantKey = t.merchant_key || null;
  const rule = merchantKey ? rules.get(merchantKey) : undefined;
  const category = t.category_id ? byId.get(t.category_id) : undefined;
  const failed = (err: Error) => Alert.alert('Could not save', err.message);

  const choose = (next: Category) => {
    setPicking(false);
    chooseCategory(t, name, next);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Title>{name}</Stack.Title>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
        <Card style={{ alignItems: 'center', gap: Spacing.xs }}>
          <Amount value={t.amount} size={32} signColor />
          <AppText tone="dim">
            {formatDate(t.date)}
            {t.pending ? ' · Pending' : ''}
          </AppText>
        </Card>

        <Card style={{ paddingVertical: Spacing.xs }}>
          <Line label="Merchant" value={name} onPress={merchantKey ? () => setRenaming(true) : undefined} />
          {rule?.display_name ? (
            <AppText variant="caption" tone="dim" style={{ paddingBottom: Spacing.sm }}>
              Renamed from {original}
            </AppText>
          ) : null}
          <Line
            label="Category"
            value={category?.name ?? 'Uncategorized'}
            icon={category}
            onPress={() => setPicking(true)}
          />
          {rule?.category_id ? (
            <AppText variant="caption" tone="dim" style={{ paddingBottom: Spacing.sm }}>
              {name} is always {byId.get(rule.category_id)?.name ?? 'categorized by a rule'}
              {t.category_is_manual ? ', but this one was set by hand' : ''}.
            </AppText>
          ) : null}
          <Line label="Memo" value={t.notes ?? 'Add a memo'} dim={!t.notes} onPress={() => setNoting(true)} />
          <Line
            label="Account"
            value={`${t.accounts?.name ?? 'Account'}${t.accounts?.mask ? ` ···· ${t.accounts.mask}` : ''}`}
          />
          <Line label="Bank's description" value={t.name} />
        </Card>
      </ScrollView>

      <CategoryPicker
        visible={picking}
        selectedId={t.category_id}
        onSelect={choose}
        onClose={() => setPicking(false)}
        onRequestAdd={(group) => setAddTarget({ mode: 'add', group })}
      />
      <CategorySheet target={addTarget} onClose={() => setAddTarget(null)} />
      <NoteSheet
        key={`${t.id}-${noting}`}
        visible={noting}
        current={t.notes}
        isSaving={setNotes.isPending}
        onSave={(notes) =>
          setNotes.mutate({ transactionId: t.id, notes }, { onSuccess: () => setNoting(false), onError: failed })
        }
        onClose={() => setNoting(false)}
      />
      {merchantKey ? (
        <RenameSheet
          key={`${merchantKey}-${renaming}`}
          visible={renaming}
          current={name}
          original={original}
          renamed={!!rule?.display_name}
          isSaving={setRule.isPending}
          onSave={(displayName) =>
            setRule.mutate({ merchantKey, displayName }, { onSuccess: () => setRenaming(false), onError: failed })
          }
          onReset={() =>
            setRule.mutate(
              { merchantKey, displayName: null },
              { onSuccess: () => setRenaming(false), onError: failed },
            )
          }
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </View>
  );
}
