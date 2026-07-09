import { Landmark } from 'lucide-react-native';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const card = {
    backgroundColor: colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: insets.top + Spacing.md, gap: Spacing.lg }}>
      <AppText variant="display">Settings</AppText>

      <View style={card}>
        <AppText variant="section" tone="dim">
          Connections
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Landmark size={20} color={colors.textDim} strokeWidth={1.75} />
          <AppText tone="dim">No banks connected</AppText>
        </View>
        <Button
          title="Connect a bank"
          variant="secondary"
          onPress={() => Alert.alert('Not yet wired up', 'Bank connections land in the next phase, via Plaid.')}
        />
      </View>

      <View style={card}>
        <AppText variant="section" tone="dim">
          Account
        </AppText>
        <AppText>{session?.user.email}</AppText>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={async () => {
            await supabase.auth.signOut();
          }}
        />
      </View>

      <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
        Tusky v0.1.0 · Plaid Sandbox
      </AppText>
    </ScrollView>
  );
}
