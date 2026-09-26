import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, DevSettings } from 'react-native';
import 'react-native-url-polyfill/auto';

import { type Backend, pickBackend } from '@/lib/environment';

// `||` not `??` throughout: unset EXPO_PUBLIC_ vars arrive as empty strings, not undefined.
const sandbox = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
};
const real = {
  url: process.env.EXPO_PUBLIC_PROD_SUPABASE_URL || '',
  key: process.env.EXPO_PUBLIC_PROD_SUPABASE_KEY || '',
};

const BACKEND_KEY = 'tusky.backend';

function readStoredBackend(): string | null {
  try {
    // Synchronous on purpose: the client below is created at import time.
    return SecureStore.getItem(BACKEND_KEY);
  } catch {
    return null;
  }
}

/** Whether the production project is set in .env; without it there is nothing to switch to. */
export const realConfigured = Boolean(real.url && real.key);

/** The backend this launch talks to. Fixed until the app reloads. */
export const backend: Backend = pickBackend({ stored: readStoredBackend(), isDev: __DEV__, realConfigured });

const target = backend === 'real' ? real : sandbox;

/** False until the chosen backend's URL and key are set in apps/mobile/.env */
export const isSupabaseConfigured = Boolean(target.url && target.key);

/**
 * Dev builds only: switch backends. Reloads the app so every module, query and
 * session starts over against the other project. Sessions never collide:
 * supabase-js stores each project's under its own key, so each side stays
 * signed in.
 */
export function switchBackend(next: Backend) {
  SecureStore.setItem(BACKEND_KEY, next);
  DevSettings.reload();
}

export const supabase = createClient(
  target.url || 'http://localhost:54321',
  target.key || 'unconfigured',
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
