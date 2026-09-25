import { Check, Plus, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildTree, pickerSections } from '@/lib/categories';
import { type Category, useCategories } from '@/lib/queries';

const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};

type Props = {
  visible: boolean;
  selectedId: string | null;
  onSelect: (category: Category) => void;
  onClose: () => void;
  /**
   * "Add a category" under a group, when provided. Mounting a second Modal
   * (CategorySheet) inside this Sheet's own Modal breaks Android rendering, so
   * the caller owns that sheet as a sibling and this just hands back the group.
   */
  onRequestAdd?: (group: Category) => void;
};

export function CategoryPicker({ visible, selectedId, onSelect, onClose, onRequestAdd }: Props) {
  const colors = useTheme();
  const { data: categories = [] } = useCategories();
  const [search, setSearch] = useState('');

  // Hidden categories leave the picker, but the current one stays so its check shows.
  const allSections = useMemo(
    () => pickerSections(buildTree(categories), { selectedId }),
    [categories, selectedId],
  );

  const query = search.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!query) return allSections;
    // A matching group keeps every child; an unmatched group keeps only its matching children.
    return allSections
      .map(({ kind, groups }) => ({
        kind,
        groups: groups
          .map((group) => {
            const groupMatches = group.name.toLowerCase().includes(query);
            const children = groupMatches
              ? group.children
              : group.children.filter((c) => c.name.toLowerCase().includes(query));
            return { ...group, children };
          })
          .filter((group) => group.name.toLowerCase().includes(query) || group.children.length > 0),
      }))
      .filter((section) => section.groups.length > 0);
  }, [allSections, query]);

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setSearch('');
        onClose();
      }}
      style={{ maxHeight: '85%', paddingTop: Spacing.lg }}>
      <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
        Category
      </AppText>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          marginHorizontal: Spacing.md,
          marginBottom: Spacing.sm,
          height: 44,
          paddingHorizontal: Spacing.sm + 2,
          borderRadius: Radius.md,
          backgroundColor: colors.elevated,
        }}>
        <Search size={17} color={colors.textDim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search categories"
          placeholderTextColor={colors.textDim}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, fontFamily: Type.body, fontSize: 15, color: colors.text, padding: 0 }}
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <X size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView>
        {sections.map(({ kind, groups }) => (
          <View key={kind}>
            <AppText
              variant="caption"
              tone="dim"
              style={{
                paddingHorizontal: Spacing.md,
                paddingTop: Spacing.md,
                paddingBottom: Spacing.xs,
                textTransform: 'uppercase',
                letterSpacing: 1.1,
              }}>
              {KIND_LABEL[kind]}
            </AppText>
            {groups.map((group) => (
              <View key={group.id}>
                {/* A group is itself selectable: "this group, nothing finer". */}
                <Row category={group} selected={group.id === selectedId} onPress={() => onSelect(group)} />
                {group.children.map((child) => (
                  <Row
                    key={child.id}
                    category={child}
                    selected={child.id === selectedId}
                    indent
                    onPress={() => onSelect(child)}
                  />
                ))}
                {onRequestAdd ? (
                  <Pressable
                    onPress={() => {
                      // Close first: the add sheet is the caller's, mounted as
                      // a sibling once this one is gone, not stacked on top.
                      onClose();
                      onRequestAdd(group);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                      paddingVertical: Spacing.sm,
                      paddingLeft: Spacing.md + 34 + Spacing.sm,
                      opacity: pressed ? 0.6 : 1,
                    })}>
                    <Plus size={16} color={colors.brand} strokeWidth={2} />
                    <AppText variant="label" tone="brand">
                      Add category
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function Row({
  category,
  selected,
  indent = false,
  onPress,
}: {
  category: Category;
  selected: boolean;
  indent?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm + 2,
        paddingHorizontal: Spacing.md,
        paddingLeft: indent ? Spacing.md + 34 + Spacing.sm : Spacing.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: indent ? 28 : 34,
          height: indent ? 28 : 34,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <CategoryIcon name={category.icon} size={indent ? 14 : 17} color={category.color} />
      </View>
      <AppText variant={indent ? 'body' : 'label'} style={{ flex: 1 }}>
        {category.name}
      </AppText>
      {selected ? <Check size={18} color={colors.brand} /> : null}
    </Pressable>
  );
}
