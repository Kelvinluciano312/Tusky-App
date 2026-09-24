import { Check } from 'lucide-react-native';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildTree, sectionsByKind } from '@/lib/categories';
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
};

export function CategoryPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: categories = [] } = useCategories();
  const sections = useMemo(() => sectionsByKind(buildTree(categories)), [categories]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View
        style={{
          maxHeight: '75%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: Radius.xl,
          borderTopRightRadius: Radius.xl,
          paddingTop: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.md,
        }}>
        <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
          Category
        </AppText>

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
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
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
