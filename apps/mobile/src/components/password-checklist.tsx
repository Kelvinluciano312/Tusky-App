import { Check, Circle } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { passwordRules, passwordsMatch } from '@/lib/password';

/**
 * Live password rules under a new-password field (Phase 15b). Pass `confirm`
 * (the confirm field's text) to add a "Passwords match" row (Phase 16c).
 */
export function PasswordChecklist({
  password,
  email,
  confirm,
}: {
  password: string;
  email?: string;
  confirm?: string;
}) {
  const colors = useTheme();
  const rows: { id: string; label: string; ok: boolean }[] = passwordRules(password, email);
  if (confirm !== undefined) {
    rows.push({ id: 'match', label: 'Passwords match', ok: passwordsMatch(password, confirm) });
  }
  return (
    <View style={{ gap: 2 }}>
      {rows.map((rule) => (
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
