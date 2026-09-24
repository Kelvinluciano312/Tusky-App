import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategorySheet, type SheetTarget } from '@/components/category-sheet';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildTree, sectionsByKind } from '@/lib/categories';
import { type Category, useCategories, useCategoryOverride } from '@/lib/queries';

const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};
const sectionLabel = { textTransform: 'uppercase', letterSpacing: 1.1 } as const;

const sheetKey = (target: SheetTarget | null) =>
  target === null ? 'none' : target.mode === 'add' ? `add-${target.group.id}` : target.category.id;

/** Every category, hidden ones included, grouped: rename, recolour, hide, or add your own. */
export default function CategoriesScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: categories = [] } = useCategories();
  const sections = useMemo(() => sectionsByKind(buildTree(categories)), [categories]);
  const setOverride = useCategoryOverride();
  const [target, setTarget] = useState<SheetTarget | null>(null);

  const setHidden = (category: Category, hidden: boolean) =>
    setOverride.mutate(
      { categoryId: category.id, patch: { hidden } },
      { onError: () => Alert.alert('Could not update the category', 'Check your connection and try again.') },
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }}>
        <AppText variant="caption" tone="dim">
          Rename, recolour or hide the built-in categories, or add your own under any group. A hidden category
          leaves the picker and budget suggestions; its transactions and budget stay.
        </AppText>

        {sections.map(({ kind, groups }) => (
          <View key={kind} style={{ gap: Spacing.sm }}>
            <AppText variant="caption" tone="dim" style={sectionLabel}>
              {KIND_LABEL[kind]}
            </AppText>
            {groups.map((group) => (
              <Card key={group.id} style={{ paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md }}>
                <CategoryLine
                  category={group}
                  onPress={() => setTarget({ mode: 'edit', category: group, group: undefined })}
                  onToggle={(show) => setHidden(group, !show)}
                />
                {group.children.map((child) => (
                  <CategoryLine
                    key={child.id}
                    category={child}
                    indent
                    dimmed={group.hidden}
                    onPress={() => setTarget({ mode: 'edit', category: child, group })}
                    // A custom category is deleted, not hidden: overrides are for built-ins.
                    onToggle={child.is_custom ? undefined : (show) => setHidden(child, !show)}
                  />
                ))}
                <Pressable
                  onPress={() => setTarget({ mode: 'add', group })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.sm,
                    paddingVertical: Spacing.sm,
                    paddingLeft: Spacing.lg,
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  <Plus size={16} color={colors.brand} strokeWidth={2} />
                  <AppText variant="label" tone="brand">
                    Add category
                  </AppText>
                </Pressable>
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>

      <CategorySheet key={sheetKey(target)} target={target} onClose={() => setTarget(null)} />
    </View>
  );
}

function CategoryLine({
  category,
  indent = false,
  dimmed = false,
  onPress,
  onToggle,
}: {
  category: Category;
  indent?: boolean;
  /** Its group is hidden, which hides it too. */
  dimmed?: boolean;
  onPress: () => void;
  onToggle?: (show: boolean) => void;
}) {
  const colors = useTheme();
  const faded = category.hidden || dimmed;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm,
        paddingLeft: indent ? Spacing.lg : 0,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View
        style={{
          width: indent ? 28 : 34,
          height: indent ? 28 : 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: faded ? 0.5 : 1,
        }}>
        <CategoryIcon name={category.icon} size={indent ? 14 : 17} color={category.color} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant={indent ? 'body' : 'label'} tone={faded ? 'dim' : 'default'}>
          {category.name}
        </AppText>
        {category.is_custom ? (
          <AppText variant="caption" tone="dim">
            Custom
          </AppText>
        ) : category.hidden ? (
          <AppText variant="caption" tone="dim">
            Hidden
          </AppText>
        ) : null}
      </View>
      {onToggle ? (
        <Switch
          value={!category.hidden}
          accessibilityLabel={`Show ${category.name}`}
          trackColor={{ false: colors.elevated, true: colors.brand }}
          onValueChange={onToggle}
        />
      ) : null}
    </Pressable>
  );
}
