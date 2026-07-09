import { ArrowLeftRight } from 'lucide-react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { useTheme } from '@/hooks/use-theme';

export default function TransactionsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <EmptyState
        icon={ArrowLeftRight}
        title="No transactions yet"
        message="Transactions appear here automatically after you connect a bank."
      />
    </View>
  );
}
