import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CashFlowBars } from '@/components/charts/cash-flow-bars';
import { SpendingDonut } from '@/components/charts/donut';
import { MonthStepper } from '@/components/month-stepper';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentMonthStart, monthsEndingAt } from '@/lib/month';
import { useCategories, useMonthlyTotals } from '@/lib/queries';
import { buildCashFlow, buildCategorySlices } from '@/lib/reports';

/** Months of history in the cash-flow chart, and the range the donut can browse. */
const WINDOW = 6;

const sectionLabel = { textTransform: 'uppercase', letterSpacing: 1.1 } as const;

export default function ReportsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  // One window, one query. The stepper is bounded to it, so the donut never asks
  // for a month the chart has not already loaded.
  const months = useMemo(() => monthsEndingAt(currentMonthStart(), WINDOW), []);
  const [month, setMonth] = useState(months[months.length - 1]);

  const { data: categories = [] } = useCategories();
  const { data: totals = [], error } = useMonthlyTotals(months[0], months[months.length - 1]);

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const cashFlow = useMemo(
    () => buildCashFlow(totals, months, categoriesById),
    [totals, months, categoriesById],
  );
  const slices = useMemo(
    () => buildCategorySlices(totals.filter((t) => t.month === month), categoriesById),
    [totals, month, categoriesById],
  );

  const selected = cashFlow.find((m) => m.month === month);
  const hasData = totals.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.lg }}>
        <AppText variant="display">Reports</AppText>

        {error ? (
          <AppText variant="caption" tone="negative">
            Could not load your spending history.
          </AppText>
        ) : null}

        {hasData ? (
          <>
            <Card style={{ gap: Spacing.md }}>
              <View>
                <AppText variant="caption" tone="dim" style={sectionLabel}>
                  Cash flow
                </AppText>
                <AppText variant="caption" tone="dim">
                  Last {WINDOW} months. Transfers excluded.
                </AppText>
              </View>

              <CashFlowBars months={cashFlow} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Legend color={colors.positive} label="Income" />
                <Legend color={colors.negative} label="Expenses" />
              </View>

              {selected ? (
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    paddingTop: Spacing.sm,
                  }}>
                  <AppText variant="label" tone="dim">
                    Net this month
                  </AppText>
                  <Amount value={selected.net} size={17} signColor />
                </View>
              ) : null}
            </Card>

            <MonthStepper
              month={month}
              onChange={setMonth}
              min={months[0]}
              max={months[months.length - 1]}
            />

            {slices.length > 0 ? (
              <Card style={{ gap: Spacing.lg }}>
                <View style={{ alignItems: 'center' }}>
                  <SpendingDonut slices={slices} />
                </View>

                <View style={{ gap: Spacing.sm }}>
                  {slices.map((slice) => (
                    <View
                      key={slice.id}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2 }}>
                      <View
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: Radius.full,
                          backgroundColor: colors.elevated,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <CategoryIcon name={slice.icon} size={15} color={slice.color} />
                      </View>
                      <AppText variant="label" style={{ flex: 1 }}>
                        {slice.name}
                      </AppText>
                      <AppText variant="caption" tone="dim" style={{ width: 42, textAlign: 'right' }}>
                        {Math.round(slice.share * 100)}%
                      </AppText>
                      <Amount value={slice.spent} size={14} />
                    </View>
                  ))}
                </View>
              </Card>
            ) : (
              <Card style={{ alignItems: 'center' }}>
                <AppText tone="dim" style={{ textAlign: 'center' }}>
                  No spending recorded in this month.
                </AppText>
              </Card>
            )}
          </>
        ) : (
          <Card style={{ alignItems: 'center', gap: Spacing.sm }}>
            <AppText variant="title">Reports need data</AppText>
            <AppText tone="dim" style={{ textAlign: 'center' }}>
              Cash flow and spending charts fill in once your first transactions sync.
            </AppText>
          </Card>
        )}

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2 }}>
      <View style={{ width: 8, height: 8, borderRadius: Radius.full, backgroundColor: color }} />
      <AppText variant="caption" tone="dim">
        {label}
      </AppText>
    </View>
  );
}
