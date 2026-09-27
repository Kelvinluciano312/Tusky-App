import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { monthsEndingAt } from '@/lib/month';
import {
  buildPresets,
  estimateIncome,
  HISTORY_MONTHS,
  historyWindow,
  type Preset,
  type PresetLine,
  typicalByLine,
} from '@/lib/presets';
import { useCategories, useMonthlyTotals } from '@/lib/queries';

type Props = {
  visible: boolean;
  onApply: (lines: PresetLine[]) => void;
  onClose: () => void;
  isSaving?: boolean;
};

/**
 * Build a whole budget from the herd's own history (Phase 13). The income
 * estimate is editable, because a median of three months is a guess: a raise,
 * a gap or a side job all make it wrong, and only the user knows which.
 */
export function PresetSheet({ visible, onApply, onClose, isSaving }: Props) {
  const colors = useTheme();
  const { from, to } = useMemo(() => historyWindow(new Date()), []);
  const { data: categories = [] } = useCategories();
  const { data: totals = [] } = useMonthlyTotals(from, to);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const months = useMemo(() => monthsEndingAt(to, HISTORY_MONTHS), [to]);
  const typical = useMemo(() => typicalByLine(totals, months, byId), [totals, months, byId]);
  const estimate = useMemo(() => estimateIncome(totals, months, byId), [totals, months, byId]);

  // Seeded once per mount; the screen keys this component on `visible`, so each
  // opening starts from a fresh estimate rather than the last typed value.
  const [income, setIncome] = useState(() => (estimate > 0 ? String(Math.round(estimate)) : ''));
  const [chosen, setChosen] = useState<Preset['id'] | null>(null);

  const parsedIncome = Number(income.replace(',', '.'));
  const usableIncome = Number.isFinite(parsedIncome) && parsedIncome > 0 ? parsedIncome : null;
  const presets = useMemo(() => buildPresets(typical, usableIncome, byId), [typical, usableIncome, byId]);
  const selected = presets.find((p) => p.id === chosen) ?? null;
  const nothingToUse = typical.size === 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      style={{ maxHeight: '88%', paddingTop: Spacing.lg, paddingHorizontal: Spacing.md, gap: Spacing.md }}>
      <AppText variant="title">Build my budget</AppText>

      {nothingToUse ? (
        <AppText tone="dim">
          Tusky needs a full month of spending before it can suggest a budget. Come back once this
          month is over, or set a budget by hand below.
        </AppText>
      ) : (
        <ScrollView contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.md }}>
          <View style={{ gap: Spacing.xs }}>
            <TextField
              label="Monthly income"
              value={income}
              onChangeText={setIncome}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <AppText variant="caption" tone="dim">
              {estimate > 0
                ? 'Estimated from your last 3 months. Change it if it looks wrong.'
                : 'We could not find income in the last 3 months. Enter it to use a percentage preset.'}
            </AppText>
          </View>

          {presets.map((preset) => {
            const disabled = preset.needsIncome;
            const isChosen = preset.id === chosen;
            return (
              <Pressable
                key={preset.id}
                disabled={disabled}
                onPress={() => setChosen(preset.id)}
                style={{
                  padding: Spacing.md,
                  gap: Spacing.xs,
                  borderRadius: Radius.lg,
                  borderWidth: 1,
                  borderColor: isChosen ? colors.brand : colors.border,
                  backgroundColor: isChosen ? colors.elevated : 'transparent',
                  opacity: disabled ? 0.5 : 1,
                }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="label">{preset.name}</AppText>
                  {disabled ? null : <Amount value={-preset.total} size={16} />}
                </View>
                <AppText variant="caption" tone="dim">
                  {disabled
                    ? 'Enter your income to use this one.'
                    : preset.savings !== null
                      ? `${preset.blurb} Leaves ${preset.savings < 0 ? 'you short by ' : ''}${Math.abs(Math.round(preset.savings))} a month.`
                      : preset.blurb}
                </AppText>
              </Pressable>
            );
          })}

          {selected ? (
            <View style={{ gap: Spacing.xs }}>
              <AppText variant="caption" tone="dim" style={{ textTransform: 'uppercase', letterSpacing: 1.1 }}>
                What you would get
              </AppText>
              {[...selected.lines]
                .sort((a, b) => b.amount - a.amount)
                .map((line) => {
                  const category = byId.get(line.categoryId);
                  return (
                    <View
                      key={line.categoryId}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }}>
                      <CategoryIcon name={category?.icon} size={16} color={category?.color ?? colors.textDim} />
                      <AppText style={{ flex: 1 }}>{category?.name ?? 'Category'}</AppText>
                      <Amount value={-line.amount} size={15} />
                    </View>
                  );
                })}
              {selected.savings !== null ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.xs }}>
                  <AppText variant="label">{selected.savings < 0 ? 'Short by' : 'Left to save'}</AppText>
                  <Amount value={Math.abs(selected.savings)} size={15} />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {nothingToUse ? null : (
        <Button
          title="Apply this budget"
          disabled={!selected || selected.lines.length === 0}
          loading={isSaving}
          onPress={() => selected && onApply(selected.lines)}
        />
      )}
    </Sheet>
  );
}
