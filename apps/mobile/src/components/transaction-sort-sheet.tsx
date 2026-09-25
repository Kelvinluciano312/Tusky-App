import { Check } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Sheet } from '@/components/ui/sheet';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TransactionSort = 'newest' | 'oldest' | 'expensive' | 'cheap';

const OPTIONS: { value: TransactionSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'expensive', label: 'Most expensive first' },
  { value: 'cheap', label: 'Least expensive first' },
];

type Props = {
  visible: boolean;
  value: TransactionSort;
  onSelect: (sort: TransactionSort) => void;
  onClose: () => void;
};

export function TransactionSortSheet({ visible, value, onSelect, onClose }: Props) {
  const colors = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg }}>
      <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
        Sort by
      </AppText>
      {OPTIONS.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => {
            onSelect(option.value);
            onClose();
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: Spacing.sm + 4,
            paddingHorizontal: Spacing.md,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <AppText variant="label">{option.label}</AppText>
          {option.value === value ? <Check size={18} color={colors.brand} /> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}
