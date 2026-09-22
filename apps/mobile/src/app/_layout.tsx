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

import { Palette } from '@/constants/theme';
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
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={scheme === 'light' ? navThemes.light : navThemes.dark}>
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
          <RootNavigator fontsLoaded={fontsLoaded} />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { session, isLoading } = useSession();
  const ready = fontsLoaded && !isLoading;

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
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
