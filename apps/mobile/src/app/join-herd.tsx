import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeCode } from '@/lib/herd';

/** Type or paste an invite code; the invite itself opens at /join/[code], where invite links land too. */
export default function JoinScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const code = normalizeCode(value);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <AppText tone="dim">Enter the code from your invite. It looks like ABCD-1234.</AppText>
      <TextField
        label="Invite code"
        value={value}
        onChangeText={setValue}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        autoFocus
      />
      <Button
        title="Continue"
        disabled={!code}
        onPress={() => code && router.replace({ pathname: '/join/[code]', params: { code } })}
      />
    </ScrollView>
  );
}
