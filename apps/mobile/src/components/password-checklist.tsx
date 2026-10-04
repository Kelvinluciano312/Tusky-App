import { Check, Circle } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { passwordRules } from '@/lib/password';

/** Live password rules under a new-password field (Phase 15b). */
export function PasswordChecklist({ password, email }: { password: string; email?: string }) {
  const colors = useTheme();
  return (
    <View style={{ gap: 2 }}>
      {passwordRules(password, email).map((rule) => (
        <View key={rule.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
          {rule.ok ? (
            <Check size={14} color={colors.positive} strokeWidth={2.25} />
          ) : (
            <Circle size={14} color={colors.textDim} strokeWidth={1.75} />
          )}
          <AppText variant="caption" tone={rule.ok ? 'positive' : 'dim'}>
            {rule.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}
