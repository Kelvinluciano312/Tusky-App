import { Alert, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/constants/legal';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAcceptTerms } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

/**
 * Shown to a signed-in user who has not accepted the current terms (Phase 15c):
 * everyone who signed up before Tusky had its own, and everyone again when the
 * version changes. New accounts accept on the sign-up screen.
 */
export default function AcceptTermsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const accept = useAcceptTerms();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding: Spacing.lg,
        paddingTop: insets.top + Spacing.xl,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.md,
      }}>
      <AppText style={{ fontFamily: Type.display, fontSize: 32, lineHeight: 40 }}>Tusky&apos;s terms</AppText>
      <AppText tone="dim">
        Tusky now has its own Terms of Service. Please read them and the Privacy Policy, then accept to keep using
        Tusky.
      </AppText>
      <View style={{ gap: Spacing.sm }}>
        <Button title="Read the Terms of Service" variant="secondary" onPress={() => void Linking.openURL(TERMS_URL)} />
        <Button title="Read the Privacy Policy" variant="secondary" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </View>
      <Button
        title="I accept"
        loading={accept.isPending}
        onPress={() =>
          accept.mutate(TERMS_VERSION, {
            onError: (err) => Alert.alert('Could not save that', err.message),
          })
        }
      />
      <Button title="Sign out" variant="ghost" onPress={() => void supabase.auth.signOut()} />
    </ScrollView>
  );
}
