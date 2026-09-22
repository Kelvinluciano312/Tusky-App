import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  message: string;
};

/** An empty screen is an invitation to act — icon, one-line title, one direction. */
export function EmptyState({ icon: Icon, title, message }: EmptyStateProps) {
  const colors = useTheme();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: Radius.full,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: Spacing.sm,
        }}>
        <Icon size={28} color={colors.brand} strokeWidth={1.75} />
      </View>
      <AppText variant="title">{title}</AppText>
      <AppText tone="dim" style={{ textAlign: 'center', maxWidth: 280 }}>
        {message}
      </AppText>
    </View>
  );
}
