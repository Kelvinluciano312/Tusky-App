// Device registration and tap handling. Native, so the pure tests do not import it.
// Permission is requested only from enableNotifications, which the onboarding
// step, the Home card, and Settings call after the person taps Turn on.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { Platform } from 'react-native';

import { routeForNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: notification.request.content.sound != null,
    shouldSetBadge: false,
  }),
});

let lastToken: string | null = null;

export function deviceTimeZone(): string {
  try {
    const zone = Localization.getCalendars()[0]?.timeZone;
    if (zone) return zone;
  } catch {
    // Intl below is the fallback when the calendar list is empty.
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('digest', {
    name: 'Digests',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Alerts',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('silent', {
    name: 'Quiet',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
  });
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function saveTimeZone(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  await supabase.from('notification_prefs').upsert(
    { user_id: userId, timezone: deviceTimeZone() },
    { onConflict: 'user_id' },
  );
}

async function registerToken(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  await ensureAndroidChannels();
  const token = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  const value = token.data;
  if (!value) return;
  lastToken = value;
  const { error } = await supabase.rpc('register_push_token', {
    p_token: value,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;
  await saveTimeZone();
}

/** Records a token when permission was already granted. Does not prompt. */
export async function registerIfGranted(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted) return;
    await registerToken();
  } catch {
    // A simulator, or a token endpoint that is down. The app keeps working.
  }
}

/** The OS prompt. Call it only after the person taps Turn on. */
export async function enableNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  const current = await Notifications.getPermissionsAsync();
  const next = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!next.granted) return 'denied';
  await registerToken();
  return 'granted';
}

/** Drops this device's token while the session is still valid. Call before sign-out. */
export async function releasePushToken(): Promise<void> {
  try {
    let token = lastToken;
    if (!token && Platform.OS !== 'web' && Device.isDevice) {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
      }
    }
    if (!token) return;
    await supabase.rpc('unregister_push_token', { p_token: token });
    lastToken = null;
  } catch {
    // Signing out still proceeds. The next sign-in on this device moves the token.
  }
}

function openNotification(data: unknown) {
  const route = routeForNotification(data);
  if (route) router.push(route as Href);
}

/** Taps, including the one that cold-started the app. */
export function listenForNotificationOpens(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    openNotification(response.notification.request.content.data);
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) openNotification(response.notification.request.content.data);
  }).catch(() => undefined);
  return () => subscription.remove();
}
