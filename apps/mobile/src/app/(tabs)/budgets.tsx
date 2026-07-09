import { Target } from 'lucide-react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { useTheme } from '@/hooks/use-theme';

export default function BudgetsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <EmptyState
        icon={Target}
        title="No budgets yet"
        message="Set your first budget once transactions are flowing in."
      />
    </View>
  );
}
