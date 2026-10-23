/// <reference types="node" />
// App Store Connect scans linked native code. These assertions lock the
// purpose strings and the fact that calendar access is asked for in one place.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
  expo: {
    ios?: { infoPlist?: Record<string, string> };
    android?: { blockedPermissions?: string[] };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

const CALENDAR_PURPOSE = 'Tusky adds your recurring bills to your calendar when you ask it to.';
const REMINDERS_PURPOSE =
  "Tusky doesn't use your reminders. This message is required because an included library references them.";

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

test('calendarPermission is the add-to-calendar explanation', () => {
  assert.equal(pluginOptions('expo-calendar')?.calendarPermission, CALENDAR_PURPOSE);
});

test('remindersPermission is an honest library string', () => {
  // App code never reads or writes reminders. The linked ExpoCalendar pod does,
  // and that is what makes Apple require the key.
  assert.equal(pluginOptions('expo-calendar')?.remindersPermission, REMINDERS_PURPOSE);
});

test('Android calendar permissions stay available for add-to-calendar', () => {
  const blocked = app.expo.android?.blockedPermissions ?? [];
  assert.equal(blocked.includes('android.permission.READ_CALENDAR'), false);
  assert.equal(blocked.includes('android.permission.WRITE_CALENDAR'), false);
  assert.equal(blocked.includes('android.permission.READ_EXTERNAL_STORAGE'), true);
  assert.equal(blocked.includes('android.permission.WRITE_EXTERNAL_STORAGE'), true);
});

test('Face ID, photo, camera, and location purpose strings stay unset', () => {
  const plist = app.expo.ios?.infoPlist ?? {};
  for (const key of [
    'NSFaceIDUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSCameraUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription',
  ]) {
    assert.equal(key in plist, false, key);
  }
  assert.equal(pluginOptions('expo-secure-store')?.faceIDPermission, false);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [];
  });
}

test('calendar permission is requested only from the add-to-calendar screen', () => {
  const callers = sourceFiles(join(root, 'src')).filter((file) => {
    if (file.endsWith('.test.ts')) return false;
    return readFileSync(file, 'utf8').includes('requestCalendarPermissionsAsync');
  });
  assert.deepEqual(
    callers.map((file) => file.slice(root.length + 1)),
    ['src/app/recurring.tsx'],
  );
});

test('app code never asks for reminders or Face ID', () => {
  const banned = ['requestRemindersPermissionsAsync', 'requireAuthentication: true', 'canUseBiometricAuthentication'];
  for (const file of sourceFiles(join(root, 'src'))) {
    if (file.endsWith('.test.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const needle of banned) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});
