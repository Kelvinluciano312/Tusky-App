import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CUSTOM_ICONS, SWATCHES, changedFields, deleteCategoryMessage, validateCategoryName } from '@/lib/categories';
import {
  type Category,
  countCategoryTransactions,
  useBudgets,
  useCategoryOverride,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/lib/queries';

/** Edit a category (group is its group, undefined for a group), or add one under a group. */
export type SheetTarget =
  | { mode: 'edit'; category: Category; group: Category | undefined }
  | { mode: 'add'; group: Category };

type Props = {
  /** Null closes the sheet. */
  target: SheetTarget | null;
  onClose: () => void;
};

/**
 * One sheet for every category edit. A built-in takes a name and a colour
 * (stored as this user's override); the user's own category also takes an icon
 * and can be deleted.
 */
export function CategorySheet({ target, onClose }: Props) {
  const colors = useTheme();
  const editing = target?.mode === 'edit' ? target.category : null;
  const group = target?.group;
  // Seeded once per mount. The screen keys this sheet by target, as Budgets
  // keys BudgetSheet, so reopening never carries the last edit over.
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? 'Tag');
  const [color, setColor] = useState(editing?.color ?? group?.color ?? SWATCHES[0]);

  const { data: budgets = [] } = useBudgets();
  const setOverride = useCategoryOverride();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const valid = validateCategoryName(name);
  const custom = target?.mode === 'add' || editing?.is_custom === true;
  const busy =
    setOverride.isPending || createCategory.isPending || updateCategory.isPending || deleteCategory.isPending;
  const failed = () => Alert.alert('Could not save the category', 'Check your connection and try again.');

  const save = async () => {
    if (!target || !valid) return;
    try {
      if (target.mode === 'add') {
        await createCategory.mutateAsync({ parentId: target.group.id, name: valid, icon, color });
      } else if (target.category.is_custom) {
        await updateCategory.mutateAsync({ id: target.category.id, name: valid, icon, color });
      } else {
        const patch = changedFields(target.category, { name: valid, color });
        if (Object.keys(patch).length > 0) {
          await setOverride.mutateAsync({ categoryId: target.category.id, patch });
        }
      }
      onClose();
    } catch {
      failed();
    }
  };

  const reset = async () => {
    if (!editing) return;
    try {
      await setOverride.mutateAsync({ categoryId: editing.id, patch: null });
      onClose();
    } catch {
      failed();
    }
  };

  const confirmDelete = async () => {
    if (!editing) return;
    let count: number;
    try {
      count = await countCategoryTransactions(editing.id);
    } catch {
      failed();
      return;
    }
    const hasBudget = budgets.some((b) => b.category_id === editing.id);
    Alert.alert(`Delete ${editing.name}?`, deleteCategoryMessage(count, group?.name ?? 'its group', hasBudget), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteCategory.mutateAsync(editing.id).then(onClose, (err: Error) =>
            Alert.alert('Could not delete the category', err.message),
          ),
      },
    ]);
  };

  return (
    <Sheet
      visible={target !== null}
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
          <CategoryIcon name={icon} size={17} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="title">{target?.mode === 'add' ? 'New category' : (editing?.name ?? '')}</AppText>
          {group ? (
            <AppText variant="caption" tone="dim">
              In {group.name}
            </AppText>
          ) : null}
        </View>
      </View>

      <TextField label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="e.g. Date night" />

      {custom ? (
        <View style={{ gap: Spacing.xs + 2 }}>
          <AppText variant="label" tone="dim">
            Icon
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
            {CUSTOM_ICONS.map((iconName) => (
              <Pressable
                key={iconName}
                accessibilityLabel={`Icon ${iconName}`}
                onPress={() => setIcon(iconName)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: Radius.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: icon === iconName ? colors.elevated : 'transparent',
                  borderWidth: icon === iconName ? 1 : 0,
                  borderColor: colors.brand,
                }}>
                <CategoryIcon name={iconName} size={17} color={icon === iconName ? color : colors.textDim} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: Spacing.xs + 2 }}>
        <AppText variant="label" tone="dim">
          Colour
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
          {SWATCHES.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityLabel={`Colour ${swatch}`}
              onPress={() => setColor(swatch)}
              style={{
                width: 30,
                height: 30,
                borderRadius: Radius.full,
                backgroundColor: swatch,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {color === swatch ? <Check size={16} color={colors.bg} /> : null}
            </Pressable>
          ))}
        </View>
      </View>

      <Button
        title={target?.mode === 'add' ? 'Add category' : 'Save'}
        disabled={!valid}
        loading={busy}
        onPress={() => void save()}
      />
      {editing && !editing.is_custom && editing.overridden ? (
        <Button title="Reset to default" variant="ghost" onPress={() => void reset()} />
      ) : null}
      {editing?.is_custom ? (
        <Button title="Delete category" variant="ghost" onPress={() => void confirmDelete()} />
      ) : null}
    </Sheet>
  );
}
