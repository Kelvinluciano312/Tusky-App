import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { AppText } from '@/components/ui/app-text';

/** iOS shows a modal without a Back button, so the paywall needs its own way out. */
export function PaywallClose() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => router.back()}>
      <AppText variant="label" tone="brand">
        Close
      </AppText>
    </Pressable>
  );
}
