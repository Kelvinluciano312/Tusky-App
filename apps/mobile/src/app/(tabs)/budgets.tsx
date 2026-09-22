import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BudgetRow } from '@/components/budget-row';
import { BudgetSheet } from '@/components/budget-sheet';
import { MonthStepper } from '@/components/month-stepper';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

  const spent = useMemo(() => spentByCategory(totals), [totals]);
  const budgetByCategory = useMemo(
    () => new Map(budgets.map((b) => [b.category_id, b])),
    [budgets],
  );

  // Only expenses are budgetable. Income and transfers are not spending.
  const expenses = useMemo(() => categories.filter((c) => c.kind === 'expense'), [categories]);
  const budgeted = expenses.filter((c) => budgetByCategory.has(c.id));
  // Everything else, biggest spender first: this is the discovery path, which is
  // why there is no separate "add a budget" button or blank form.
  const unbudgeted = expenses
    .filter((c) => !budgetByCategory.has(c.id))
    .sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0));

  const totalBudgeted = budgeted.reduce((sum, c) => sum + (budgetByCategory.get(c.id)?.amount ?? 0), 0);
  const totalSpent = budgeted.reduce((sum, c) => sum + (spent.get(c.id) ?? 0), 0);

  const hasAnything = budgeted.length > 0 || spent.size > 0;

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

            {budgeted.length > 0 ? (
              <View style={{ gap: Spacing.xs }}>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Budgets
                </AppText>
                {budgeted.map((category) => (
                  <BudgetRow
                    key={category.id}
                    category={category}
                    spent={spent.get(category.id) ?? 0}
                    budget={budgetByCategory.get(category.id)?.amount}
                    onPress={() => setEditing(category)}
                  />
                ))}
              </View>
            ) : null}

            <View style={{ gap: Spacing.xs }}>
              <AppText variant="caption" tone="dim" style={sectionLabel}>
                Not budgeted
              </AppText>
              {unbudgeted.map((category) => (
                <BudgetRow
                  key={category.id}
                  category={category}
                  spent={spent.get(category.id) ?? 0}
                  onPress={() => setEditing(category)}
                />
              ))}
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
          if (editing) setBudget.mutate({ categoryId: editing.id, amount });
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
