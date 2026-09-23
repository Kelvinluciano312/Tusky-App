import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
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
  const insets = useSafeAreaInsets();
  // Seeded once per mount. The screen keys this component by category, so
  // reopening for a different one remounts rather than carrying the last amount
  // over — no effect, and nothing to keep in sync.
  const [value, setValue] = useState(() => (budget ? String(budget.amount) : ''));

  const parsed = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Modal visible={category !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: Radius.xl,
          borderTopRightRadius: Radius.xl,
          paddingTop: Spacing.lg,
          paddingHorizontal: Spacing.md,
          paddingBottom: insets.bottom + Spacing.md,
          gap: Spacing.md,
        }}>
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

        <Button
          title="Save budget"
          disabled={!valid}
          loading={isSaving}
          onPress={() => onSave(parsed)}
        />

        {budget ? (
          <Button title="Remove budget" variant="ghost" onPress={() => onRemove(budget.id)} />
        ) : null}
      </View>
    </Modal>
  );
}
