import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Budget, Category } from '@/lib/queries';

type Props = {
  /** Null closes the sheet; a category opens it for that category. */
  category: Category | null;
  /** The existing budget for that category, if any. */
  budget?: Budget;
  onSave: (amount: number) => void;
  onRemove: (budgetId: string) => void;
  onClose: () => void;
  isSaving?: boolean;
};

export function BudgetSheet({ category, budget, onSave, onRemove, onClose, isSaving }: Props) {
  const colors = useTheme();
  // Seeded once per mount. The screen keys this component by category, so
  // reopening for a different one remounts rather than carrying the last amount
  // over — no effect, and nothing to keep in sync.
  const [value, setValue] = useState(() => (budget ? String(budget.amount) : ''));

  const parsed = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Sheet
      visible={category !== null}
      onClose={onClose}
      avoidKeyboard
      style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md, gap: Spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <CategoryIcon name={category?.icon} size={17} color={category?.color ?? colors.textDim} />
        </View>
        <AppText variant="title">{category?.name ?? 'Budget'}</AppText>
      </View>

      <TextField
        label="Monthly budget"
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus
      />

      <AppText variant="caption" tone="dim">
        Applies to every month.
      </AppText>

      <Button title="Save budget" disabled={!valid} loading={isSaving} onPress={() => onSave(parsed)} />

      {budget ? <Button title="Remove budget" variant="ghost" onPress={() => onRemove(budget.id)} /> : null}
    </Sheet>
  );
}
