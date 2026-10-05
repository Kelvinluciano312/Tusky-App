import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RealDataBanner } from '@/components/real-data-banner';
import { DialogHost } from '@/components/ui/dialog';
import { Palette } from '@/constants/theme';
import { TERMS_VERSION } from '@/constants/legal';
import { gateFor } from '@/lib/first-run';
import { identifyPurchaser } from '@/lib/purchases';
import { useFirstRun } from '@/lib/queries';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// React Native has no window focus, so tell React Query when the app returns to
// the foreground. Plaid webhooks change the database while the app is in the
// background; this refetch is how those changes reach the screen.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => subscription.remove();
});

const navThemes = {
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: Palette.dark.bg,
      card: Palette.dark.surface,
      text: Palette.dark.text,
      primary: Palette.dark.brand,
      border: 'transparent',
    },
  },
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: Palette.light.bg,
      card: Palette.light.surface,
      text: Palette.light.text,
      primary: Palette.light.brand,
      border: 'transparent',
    },
  },
};

export default function RootLayout() {
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  return (
    // Gestures anywhere in the app (the review deck's swipes) need this at the root.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={scheme === 'light' ? navThemes.light : navThemes.dark}>
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
          <RootNavigator fontsLoaded={fontsLoaded} />
          <RealDataBanner />
          <DialogHost />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { session, isLoading } = useSession();
  const userId = session?.user.id ?? null;
  // Phase 15c: terms, then the first-run steps, then the app. The splash waits
  // for the answer so the app never flashes before the terms screen.
  const firstRun = useFirstRun(userId ?? undefined);
  const gate = session ? gateFor(firstRun.data ?? null, TERMS_VERSION) : null;
  const ready = fontsLoaded && !isLoading && !(session && firstRun.isLoading);

  // RevenueCat's user follows the Supabase user (Phase 14c).
  useEffect(() => {
    void identifyPurchaser(userId);
  }, [userId]);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null; // splash stays up until fonts and the persisted session are restored
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate === 'terms'}>
        <Stack.Screen name="accept-terms" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'onboarding'}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'app'}>
        <Stack.Screen name="(tabs)" />
        {/* Pushed from Home's Upcoming card; the native header supplies Back. */}
        <Stack.Screen name="recurring" options={{ headerShown: true, title: 'Recurring' }} />
        {/* Pushed from Settings and Home's account rows; the page sets its own title. */}
        <Stack.Screen name="bank/[id]" options={{ headerShown: true, title: '' }} />
        {/* Pushed from Settings. */}
        <Stack.Screen name="categories" options={{ headerShown: true, title: 'Categories' }} />
        <Stack.Screen name="rules" options={{ headerShown: true, title: 'Merchant rules' }} />
        {/* Pushed from the feed; the page sets its own title. */}
        <Stack.Screen name="transaction/[id]" options={{ headerShown: true, title: '' }} />
        {/* Pushed from Home's review card; the page sets "3 of 12" as its title. */}
        <Stack.Screen name="review" options={{ headerShown: true, title: 'Review' }} />
        {/* Pushed from Settings; /join/[code] also opens from a tusky:///join/<code> invite link. */}
        <Stack.Screen name="herd" options={{ headerShown: true, title: 'Herd' }} />
        <Stack.Screen name="join-herd" options={{ headerShown: true, title: 'Join a herd' }} />
        <Stack.Screen name="join/[code]" options={{ headerShown: true, title: 'Invite' }} />
        <Stack.Screen name="plan" options={{ headerShown: true, title: 'Plan' }} />
        <Stack.Screen name="account" options={{ headerShown: true, title: 'Account & privacy' }} />
        <Stack.Screen name="paywall" options={{ headerShown: true, title: 'Plans', presentation: 'modal' }} />
        {/* Pushed from Home's balance card and the herd screen (11b). */}
        <Stack.Screen name="settle" options={{ headerShown: true, title: 'Settle up' }} />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
