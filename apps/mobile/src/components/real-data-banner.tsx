import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { backend } from '@/lib/supabase';

/**
 * A dev build pointed at the production project says so on every screen, so
 * real banks are never mistaken for Sandbox. Release builds are always real
 * data and show nothing.
 */
export function RealDataBanner() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  if (!__DEV__ || backend !== 'real') return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 2, left: 0, right: 0, alignItems: 'center' }}>
      <View
        style={{
          backgroundColor: colors.negative,
          borderRadius: Radius.full,
          paddingHorizontal: Spacing.sm + 2,
          paddingVertical: 2,
        }}>
        <AppText variant="caption" style={{ color: colors.onBrand, fontWeight: '600' }}>
          REAL DATA
        </AppText>
      </View>
    </View>
  );
}
