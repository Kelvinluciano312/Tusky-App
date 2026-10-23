import { Bell } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { dialog } from '@/components/ui/dialog';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNotificationPrompt } from '@/lib/notification-prefs';

/** One dismissible ask on Home for people who onboarded before notifications existed. */
export function NotificationPrompt({ userId }: { userId: string | undefined }) {
  const colors = useTheme();
  const { show, dismiss, enable } = useNotificationPrompt(userId);
  if (!show) return null;
  return (
    <Card style={{ gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
        <Bell size={22} color={colors.brand} strokeWidth={1.75} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="title">Turn on notifications?</AppText>
          <AppText variant="caption" tone="dim">
            Tusky can tell you when someone asks about a purchase, when reviews pile up, or when a bank needs you to sign in again. You choose the rest in Settings. Nothing is sent until you turn them on.
          </AppText>
        </View>
      </View>
      <Button
        title="Turn on notifications"
        loading={enable.isPending}
        onPress={() => enable.mutate(undefined, {
          onSuccess: (result) => {
            if (result === 'denied') {
              dialog.alert('Notifications are off', 'You can allow them in your phone’s settings, then turn them on in Settings.');
            } else if (result === 'unsupported') {
              dialog.alert('Not on this device', 'Push notifications need a physical phone. You can turn them on from Settings later.');
            }
          },
        })}
      />
      <Button title="Not now" variant="ghost" disabled={dismiss.isPending} onPress={() => dismiss.mutate()} />
    </Card>
  );
}
