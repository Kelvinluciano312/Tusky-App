// Device registration and tap handling. Native, so the pure tests do not import it.
// Permission is requested only from enableNotifications, which the onboarding
// step, the Home card, and the Notifications screen call after the person taps on.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { Platform } from 'react-native';

import { routeForNotification } from '@/lib/notifications';
import {
  permissionFromSettings,
  pushFailureMessage,
  resolveProjectId,
  shouldAutoRegister,
  type PushPermission,
} from '@/lib/push-status';
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

const suppressedKey = (userId: string) => `tusky.push.suppressed.${userId}`;
const tokenKey = (userId: string) => `tusky.push.token.${userId}`;

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

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function report(error: unknown): string {
  const message = pushFailureMessage(error);
  console.error('[push]', message);
  return message;
}

async function readPermission(): Promise<PushPermission> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  const settings = await Notifications.getPermissionsAsync();
  return permissionFromSettings({
    granted: settings.granted,
    status: settings.status,
    iosStatus: settings.ios?.status ?? null,
  });
}

async function fetchExpoToken(): Promise<string> {
  const projectId = resolveProjectId(
    Constants.expoConfig?.extra?.eas?.projectId,
    Constants.easConfig?.projectId,
  );
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!token.data) throw new Error('Expo did not return a push token for this phone.');
  return token.data;
}

async function saveTimeZone(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await supabase.from('notification_prefs').upsert(
    { user_id: userId, timezone: deviceTimeZone() },
    { onConflict: 'user_id' },
  );
}

async function rememberToken(userId: string, token: string): Promise<void> {
  lastToken = token;
  await AsyncStorage.setItem(tokenKey(userId), token);
}

async function registerToken(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    throw new Error('Push notifications need a physical phone.');
  }
  await ensureAndroidChannels();
  const value = await fetchExpoToken();
  const userId = await currentUserId();
  if (userId) await rememberToken(userId, value);
  else lastToken = value;
  const { error } = await supabase.rpc('register_push_token', {
    p_token: value,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;
  await saveTimeZone();
}

async function isSuppressed(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  return (await AsyncStorage.getItem(suppressedKey(userId))) === '1';
}

async function setSuppressed(on: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  if (on) await AsyncStorage.setItem(suppressedKey(userId), '1');
  else await AsyncStorage.removeItem(suppressedKey(userId));
}

export type EnableOutcome =
  | { status: 'granted' | 'denied' | 'unsupported' }
  | { status: 'error'; message: string };

/** What this phone can do right now, including whether its token row exists. */
export async function loadDevicePush(): Promise<{
  permission: PushPermission;
  tokenRegistered: boolean;
  error: string | null;
}> {
  const permission = await readPermission();
  if (permission !== 'granted') return { permission, tokenRegistered: false, error: null };
  if (await isSuppressed()) return { permission, tokenRegistered: false, error: null };
  try {
    const token = await fetchExpoToken();
    const userId = await currentUserId();
    if (userId) await rememberToken(userId, token);
    const { data, error } = await supabase.from('push_tokens').select('token').eq('token', token).maybeSingle();
    if (error) throw error;
    return { permission, tokenRegistered: Boolean(data), error: null };
  } catch (error) {
    return { permission, tokenRegistered: false, error: report(error) };
  }
}

/** Records a token when permission was already granted and this user left them on. */
export async function registerIfGranted(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const permission = await readPermission();
    if (!shouldAutoRegister({ permission, suppressed: await isSuppressed() })) return;
    await registerToken();
  } catch (error) {
    report(error);
  }
}

/** The OS prompt. Call it only after the person turns notifications on. */
export async function enableNotifications(): Promise<EnableOutcome> {
  if (Platform.OS === 'web' || !Device.isDevice) return { status: 'unsupported' };
  try {
    await setSuppressed(false);
    let permission = await readPermission();
    if (permission === 'denied') return { status: 'denied' };
    if (permission !== 'granted') {
      const settings = await Notifications.requestPermissionsAsync();
      permission = permissionFromSettings({
        granted: settings.granted,
        status: settings.status,
        iosStatus: settings.ios?.status ?? null,
      });
    }
    if (permission !== 'granted') return { status: 'denied' };
    await registerToken();
    return { status: 'granted' };
  } catch (error) {
    return { status: 'error', message: report(error) };
  }
}

async function unregisterCurrent(): Promise<void> {
  const userId = await currentUserId();
  let token = lastToken ?? (userId ? await AsyncStorage.getItem(tokenKey(userId)) : null);
  if (!token && Platform.OS !== 'web' && Device.isDevice) {
    const permission = await readPermission();
    if (permission === 'granted') token = await fetchExpoToken();
  }
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
  if (error) throw error;
  lastToken = null;
  if (userId) await AsyncStorage.removeItem(tokenKey(userId));
}

/** Stops pushes to this phone and remembers that choice for this account. */
export async function disableNotifications(): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  try {
    await setSuppressed(true);
    await unregisterCurrent();
    return { status: 'ok' };
  } catch (error) {
    await setSuppressed(false);
    return { status: 'error', message: report(error) };
  }
}

/** Drops this device's token while the session is still valid. Call before sign-out. */
export async function releasePushToken(): Promise<void> {
  try {
    await unregisterCurrent();
  } catch (error) {
    report(error);
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
