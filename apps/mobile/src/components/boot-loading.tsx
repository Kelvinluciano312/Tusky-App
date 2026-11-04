import { ActivityIndicator, Text, View } from 'react-native';

import { BOOT_BACKGROUND } from '@/lib/notifications';

/**
 * Shown under the native splash while fonts, session, and the first-run gate
 * finish. Matches the splash green so the hand-off is not a blank flash, and
 * keeps a spinner visible if the gate takes a moment after the splash hides.
 * System type only: fonts may not be loaded yet.
 */
export function BootLoading() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: BOOT_BACKGROUND,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
      accessibilityLabel="Loading Tusky"
    >
      <Text style={{ color: '#EFEAE0', fontSize: 28, fontWeight: '600' }}>Tusky</Text>
      <ActivityIndicator color="#EFEAE0" size="large" />
    </View>
  );
}
