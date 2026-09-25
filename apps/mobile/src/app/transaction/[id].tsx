import { Stack, useLocalSearchParams } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/category-picker';
import { RenameSheet } from '@/components/rename-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { transactionName } from '@/lib/merchants';
import {
  type Category,
  useCategories,
  useMerchantRules,
  useSetMerchantRule,
  useSetTransactionCategory,
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
  const setCategory = useSetTransactionCategory();
  const setRule = useSetMerchantRule();
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
    if (next.id === t.category_id) return;
    const once = () => setCategory.mutate({ transactionId: t.id, categoryId: next.id });
    if (!merchantKey) {
      once();
      return;
    }
    Alert.alert(
      `Always categorize ${name} as ${next.name}?`,
      "Applies to past and future ones you haven't set by hand.",
      [
        { text: 'Just this one', onPress: once },
        {
          text: 'Always',
          onPress: () => {
            setRule.mutate({ merchantKey, categoryId: next.id }, { onError: failed });
            // The rule skips rows set by hand, and this one may be one.
            if (t.category_is_manual) once();
          },
        },
      ],
      { cancelable: true },
    );
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

function Line({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon?: Category;
  onPress?: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.sm + 2,
        opacity: pressed ? 0.7 : 1,
      })}>
      <AppText variant="label" tone="dim" style={{ width: 92 }}>
        {label}
      </AppText>
      {icon ? (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <CategoryIcon name={icon.icon} size={13} color={icon.color} />
        </View>
      ) : null}
      <AppText style={{ flex: 1 }} numberOfLines={2}>
        {value}
      </AppText>
      {onPress ? <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} /> : null}
    </Pressable>
  );
}
