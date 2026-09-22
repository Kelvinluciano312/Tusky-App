import { Check } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Category, useCategories } from '@/lib/queries';

const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};
const KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer'];

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
          {KIND_ORDER.map((kind) => {
            const group = categories.filter((c) => c.kind === kind);
            if (group.length === 0) return null;
            return (
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
                {group.map((category) => {
                  const selected = category.id === selectedId;
                  return (
                    <Pressable
                      key={category.id}
                      onPress={() => onSelect(category)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: Spacing.sm + 2,
                        paddingVertical: Spacing.sm + 2,
                        paddingHorizontal: Spacing.md,
                        backgroundColor: pressed ? colors.elevated : 'transparent',
                      })}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: Radius.full,
                          backgroundColor: colors.elevated,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <CategoryIcon name={category.icon} size={17} color={category.color} />
                      </View>
                      <AppText variant="label" style={{ flex: 1 }}>
                        {category.name}
                      </AppText>
                      {selected ? <Check size={18} color={colors.brand} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
