import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MerchantRule } from '@/lib/merchants';
import { useCategories, useMerchantRules, useSetMerchantRule } from '@/lib/queries';

/** Every merchant rule: a rename, an "always categorize as", or both. Rules are made from a transaction. */
export default function RulesScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: rules = new Map(), isLoading } = useMerchantRules();
  const { data: categories = [] } = useCategories();
  const setRule = useSetMerchantRule();
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const list = [...rules.values()].sort((a, b) =>
    (a.display_name ?? a.merchant_key).localeCompare(b.display_name ?? b.merchant_key),
  );

  const failed = (err: Error) => Alert.alert('Could not change the rule', err.message);
  const change = (rule: MerchantRule, patch: { categoryId?: null; displayName?: null }) =>
    setRule.mutate({ merchantKey: rule.merchant_key, ...patch }, { onError: failed });

  const open = (rule: MerchantRule) => {
    const title = rule.display_name ?? rule.merchant_key;
    // Android shows at most three buttons; with both parts, tapping outside cancels.
    const buttons =
      rule.category_id && rule.display_name
        ? [
            { text: 'Remove rename', onPress: () => change(rule, { displayName: null }) },
            { text: 'Remove category rule', onPress: () => change(rule, { categoryId: null }) },
            { text: 'Delete both', style: 'destructive' as const, onPress: () => change(rule, { categoryId: null, displayName: null }) },
          ]
        : [
            { text: 'Cancel', style: 'cancel' as const },
            { text: 'Delete rule', style: 'destructive' as const, onPress: () => change(rule, { categoryId: null, displayName: null }) },
          ];
    Alert.alert(
      title,
      rule.category_id
        ? "Removing the category rule puts Plaid's category back on the transactions you haven't set by hand."
        : 'Removing the rename shows the bank\'s name again.',
      buttons,
      { cancelable: true },
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <AppText variant="caption" tone="dim">
        Rename a merchant, or choose &quot;Always&quot; after recategorizing a transaction, and the rule shows up here.
      </AppText>
      {!isLoading && list.length === 0 ? (
        <Card>
          <AppText tone="dim">No rules yet.</AppText>
        </Card>
      ) : (
        <Card style={{ paddingVertical: Spacing.xs }}>
          {list.map((rule) => {
            const category = rule.category_id ? byId.get(rule.category_id) : undefined;
            return (
              <Pressable
                key={rule.merchant_key}
                onPress={() => open(rule)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Spacing.sm + 2,
                  paddingVertical: Spacing.sm + 2,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: Radius.full,
                    backgroundColor: colors.elevated,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <CategoryIcon name={category?.icon ?? 'Tag'} size={17} color={category?.color ?? colors.textDim} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="label">{rule.display_name ?? rule.merchant_key}</AppText>
                  <AppText variant="caption" tone="dim">
                    {[
                      rule.display_name ? `Renamed from “${rule.merchant_key}”` : null,
                      category ? `Always ${category.name}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                </View>
                <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
              </Pressable>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}
