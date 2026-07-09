import { ChartPie } from 'lucide-react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { useTheme } from '@/hooks/use-theme';

export default function ReportsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <EmptyState
        icon={ChartPie}
        title="Reports need data"
        message="Cash flow and spending charts unlock after your first sync."
      />
    </View>
  );
}
