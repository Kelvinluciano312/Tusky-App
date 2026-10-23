/// <reference types="node" />
// The App Store scan looks at linked native code, not at which permission the
// app requests. These assertions lock the Info.plist answer to that scan.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
  expo: {
    ios?: { infoPlist?: Record<string, string> };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

const CALENDAR_PURPOSE =
  "Tusky doesn't access your calendar. This message is required because an included library references the calendar.";

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

test('Info.plist states why the calendar purpose strings exist', () => {
  const plist = app.expo.ios?.infoPlist;
  assert.equal(plist?.NSCalendarsUsageDescription, CALENDAR_PURPOSE);
  assert.equal(plist?.NSCalendarsFullAccessUsageDescription, CALENDAR_PURPOSE);
});

test('the calendar plugin keeps those strings and still omits reminders', () => {
  const calendar = pluginOptions('expo-calendar');
  assert.ok(calendar, 'expo-calendar plugin');
  // false deletes the key during prebuild, even when ios.infoPlist sets it.
  assert.notEqual(calendar.calendarPermission, false);
  assert.equal(calendar.remindersPermission, false);
});

test('Face ID, photo, camera, and location purpose strings stay unset', () => {
  const plist = app.expo.ios?.infoPlist ?? {};
  for (const key of [
    'NSFaceIDUsageDescription',
    'NSRemindersUsageDescription',
    'NSRemindersFullAccessUsageDescription',
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

test('app code never asks for calendar, reminder, or Face ID permission', () => {
  const banned = [
    'requestCalendarPermissionsAsync',
    'requestRemindersPermissionsAsync',
    'requestCalendarPermissions(',
    'requireAuthentication: true',
    'canUseBiometricAuthentication',
  ];
  for (const file of sourceFiles(join(root, 'src'))) {
    if (file.endsWith('.test.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const needle of banned) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});
