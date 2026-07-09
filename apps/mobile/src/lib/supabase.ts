import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False until EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are set in apps/mobile/.env */
export const isSupabaseConfigured = Boolean(url && anonKey);

// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as empty strings, not undefined.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'unconfigured',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh auth tokens only while the app is foregrounded.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
