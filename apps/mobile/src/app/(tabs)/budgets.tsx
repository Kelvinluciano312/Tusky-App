import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BudgetRow } from '@/components/budget-row';
import { BudgetSheet } from '@/components/budget-sheet';
import { MonthStepper } from '@/components/month-stepper';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildTree, budgetsReplacedBy, rollupByGroup, withoutHidden } from '@/lib/categories';
import { currentMonthStart } from '@/lib/month';
import {
  type Category,
  useBudgets,
  useCategories,
  useDeleteBudget,
  useMonthlyTotals,
  useSetBudget,
} from '@/lib/queries';
import { spentByCategory } from '@/lib/reports';

const sectionLabel = { textTransform: 'uppercase', letterSpacing: 1.1 } as const;

export default function BudgetsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(currentMonthStart);
  const [editing, setEditing] = useState<Category | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: budgets = [] } = useBudgets();
  const { data: totals = [], error } = useMonthlyTotals(month, month);
  const setBudget = useSetBudget();
  const deleteBudget = useDeleteBudget();

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const spent = useMemo(() => spentByCategory(totals), [totals]);
  const spentByGroup = useMemo(() => rollupByGroup(spent, byId), [spent, byId]);
  const budgetByCategory = useMemo(() => new Map(budgets.map((b) => [b.category_id, b])), [budgets]);
  const [showAll, setShowAll] = useState(false);

  // Only expenses are budgetable. Income and transfers — card payments
  // included — are not spending. Biggest spender first: this is the discovery
  // path, which is why there is no separate "add a budget" button or blank form.
  const groups = useMemo(
    () =>
      buildTree(categories)
        .filter((g) => g.kind === 'expense')
        .sort((a, b) => (spentByGroup.get(b.id) ?? 0) - (spentByGroup.get(a.id) ?? 0)),
    [categories, spentByGroup],
  );
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  // Suggestions skip what the user hid. Existing budgets still show, and a
  // budgeted group's breakdown still lists every category with spend.
  const discoverable = useMemo(() => withoutHidden(groups, null), [groups]);

  // What a budget's bar measures: a group budget covers its own rows plus its
  // children's, a category budget just its own. No overlap exists, because
  // budgetsReplacedBy removes it on save, so nothing counts twice.
  const spentUnder = (c: Category) => (c.parent_id === null ? spentByGroup.get(c.id) ?? 0 : spent.get(c.id) ?? 0);
  const budgetedCategories = budgets
    .map((b) => byId.get(b.category_id))
    .filter((c): c is Category => c !== undefined && c.kind === 'expense');
  const totalBudgeted = budgetedCategories.reduce((sum, c) => sum + (budgetByCategory.get(c.id)?.amount ?? 0), 0);
  const totalSpent = budgetedCategories.reduce((sum, c) => sum + spentUnder(c), 0);
  const hasAnything = budgets.length > 0 || spent.size > 0;

  const save = (category: Category, amount: number) => {
    const replaced = budgetsReplacedBy(category.id, budgets, byId);
    const write = async () => {
      try {
        for (const b of replaced) await deleteBudget.mutateAsync(b.id);
        setBudget.mutate({ categoryId: category.id, amount });
      } catch {
        Alert.alert('Could not save the budget', 'Check your connection and try again.');
      }
    };
    if (replaced.length === 0) {
      void write();
      return;
    }
    const group = category.parent_id === null ? category : byId.get(category.parent_id);
    Alert.alert(
      category.parent_id === null
        ? `Replace ${replaced.length} category budget${replaced.length === 1 ? '' : 's'} with one for ${category.name}?`
        : `Replace ${group?.name ?? 'the group'}'s budget with one for ${category.name}?`,
      'A group and its categories are never budgeted at once, so nothing counts twice.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: () => void write() },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.lg }}>
        <AppText variant="display">Budgets</AppText>

        <MonthStepper month={month} onChange={setMonth} max={currentMonthStart()} />

        {error ? (
          <AppText variant="caption" tone="negative">
            Could not load this month&apos;s spending.
          </AppText>
        ) : null}

        {hasAnything ? (
          <>
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ gap: Spacing.xs }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Budgeted
                </AppText>
                <Amount value={totalBudgeted} size={18} />
              </View>
              <View style={{ gap: Spacing.xs }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Spent
                </AppText>
                <Amount value={totalSpent} size={18} />
              </View>
              <View style={{ gap: Spacing.xs, alignItems: 'flex-end' }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Left
                </AppText>
                <Amount
                  value={totalBudgeted - totalSpent}
                  size={18}
                  style={{ color: totalSpent > totalBudgeted ? colors.negative : colors.text }}
                />
              </View>
            </Card>

            {budgetedCategories.length > 0 ? (
              <View style={{ gap: Spacing.xs }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Budgets
                </AppText>
                {[...budgetedCategories]
                  .sort((a, b) => spentUnder(b) - spentUnder(a))
                  .map((category) => (
                    <View key={category.id}>
                      <BudgetRow
                        category={category}
                        // A category budget names its group, so "Gas" reads as Transportation's.
                        label={
                          category.parent_id === null
                            ? undefined
                            : `${category.name} · ${byId.get(category.parent_id)?.name ?? ''}`
                        }
                        spent={spentUnder(category)}
                        budget={budgetByCategory.get(category.id)?.amount}
                        onPress={() => setEditing(category)}
                      />
                      {/* A group budget covers its categories: show what makes it up. */}
                      {category.parent_id === null ? (
                        <GroupBreakdown
                          group={category}
                          own={spent.get(category.id) ?? 0}
                          parts={(groupById.get(category.id)?.children ?? [])
                            .filter((child) => showAll || (spent.get(child.id) ?? 0) !== 0)
                            .sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0))
                            .map((child) => ({ category: child, spent: spent.get(child.id) ?? 0 }))}
                          onPress={setEditing}
                        />
                      ) : null}
                    </View>
                  ))}
              </View>
            ) : null}

            <View style={{ gap: Spacing.xs }}>
              <AppText variant="caption" tone="dim" style={sectionLabel}>
                Not budgeted
              </AppText>
              {discoverable
                // A group with its own budget covers its children: none of them is budgetable.
                .filter((group) => !budgetByCategory.has(group.id))
                .filter((group) => showAll || (spentByGroup.get(group.id) ?? 0) !== 0)
                .map((group) => (
                  <View key={group.id}>
                    <BudgetRow
                      category={group}
                      spent={spentByGroup.get(group.id) ?? 0}
                      onPress={() => setEditing(group)}
                    />
                    {group.children
                      .filter((child) => !budgetByCategory.has(child.id))
                      .filter((child) => showAll || (spent.get(child.id) ?? 0) !== 0)
                      .sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0))
                      .map((child) => (
                        <BudgetRow
                          key={child.id}
                          category={child}
                          indent
                          spent={spent.get(child.id) ?? 0}
                          onPress={() => setEditing(child)}
                        />
                      ))}
                  </View>
                ))}
              <Button
                title={showAll ? 'Show only categories with spending' : 'Show all categories'}
                variant="ghost"
                onPress={() => setShowAll(!showAll)}
              />
            </View>
          </>
        ) : (
          <Card style={{ alignItems: 'center', gap: Spacing.sm }}>
            <AppText variant="title">Nothing to budget yet</AppText>
            <AppText tone="dim" style={{ textAlign: 'center' }}>
              Once transactions land in this month, every spending category shows up here ready to
              budget.
            </AppText>
          </Card>
        )}

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      <BudgetSheet
        key={editing?.id ?? 'none'}
        category={editing}
        budget={editing ? budgetByCategory.get(editing.id) : undefined}
        isSaving={setBudget.isPending}
        onSave={(amount) => {
          if (editing) save(editing, amount);
          setEditing(null);
        }}
        onRemove={(budgetId) => {
          deleteBudget.mutate(budgetId);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

/**
 * A group budget's makeup: its categories' spend, as small lines rather than
 * budget rows, since the group's budget covers them. Rows on the group itself
 * read "(general)", as in Reports, but only beside a category — alone they
 * would just repeat the group's row. Tapping a category opens its budget
 * sheet, and saving there offers to replace the group's budget.
 */
function GroupBreakdown({
  group,
  own,
  parts,
  onPress,
}: {
  group: Category;
  own: number;
  parts: { category: Category; spent: number }[];
  onPress: (category: Category) => void;
}) {
  if (parts.length === 0) return null;
  const lines = own === 0 ? parts : [...parts, { category: group, spent: own }];
  return (
    <View style={{ paddingLeft: Spacing.lg + Spacing.xs, paddingRight: Spacing.xs }}>
      {lines.map(({ category, spent }) => (
        <Pressable
          key={category.id}
          onPress={() => onPress(category)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: Spacing.xs,
            opacity: pressed ? 0.6 : 1,
          })}>
          <AppText variant="caption" tone="dim" style={{ flex: 1 }}>
            {category.id === group.id ? `${group.name} (general)` : category.name}
          </AppText>
          <Amount value={spent} size={12.5} />
        </Pressable>
      ))}
    </View>
  );
}
