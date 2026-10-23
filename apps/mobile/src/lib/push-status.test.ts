/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EAS_PROJECT_ID,
  permissionFromSettings,
  pushFailureMessage,
  pushMasterState,
  pushStatusLabel,
  resolveProjectId,
  settingsAction,
  shouldAutoRegister,
} from './push-status.ts';

test('the project id falls back to the EAS project when the manifest has none', () => {
  assert.equal(EAS_PROJECT_ID, 'd03876ea-66da-42a2-9b9c-d17309acca6b');
  assert.equal(resolveProjectId(undefined, undefined), EAS_PROJECT_ID);
  assert.equal(resolveProjectId(null, null), EAS_PROJECT_ID);
  assert.equal(resolveProjectId('', ''), EAS_PROJECT_ID);
  assert.equal(resolveProjectId('from-config', undefined), 'from-config');
  assert.equal(resolveProjectId(undefined, 'from-eas'), 'from-eas');
});

test('iOS provisional and ephemeral count as allowed; denied does not', () => {
  assert.equal(permissionFromSettings({ granted: true }), 'granted');
  assert.equal(permissionFromSettings({ granted: false, iosStatus: 2 }), 'granted');
  assert.equal(permissionFromSettings({ granted: false, iosStatus: 3 }), 'granted');
  assert.equal(permissionFromSettings({ granted: false, iosStatus: 4 }), 'granted');
  assert.equal(permissionFromSettings({ granted: false, iosStatus: 1 }), 'denied');
  assert.equal(permissionFromSettings({ granted: false, status: 'denied' }), 'denied');
  assert.equal(permissionFromSettings({ granted: false, iosStatus: 0 }), 'undetermined');
  assert.equal(permissionFromSettings({ granted: false }), 'undetermined');
});

test('notifications are on only when permission is granted and this device has a token', () => {
  assert.equal(pushMasterState({ permission: 'granted', tokenRegistered: true }), 'on');
  assert.equal(pushMasterState({ permission: 'granted', tokenRegistered: false }), 'off');
  assert.equal(pushMasterState({ permission: 'undetermined', tokenRegistered: false }), 'off');
  assert.equal(pushMasterState({ permission: 'denied', tokenRegistered: false }), 'denied');
  assert.equal(pushMasterState({ permission: 'denied', tokenRegistered: true }), 'denied');
  assert.equal(pushMasterState({ permission: 'unsupported', tokenRegistered: false }), 'unsupported');
});

test('the Settings row says On only when this device is registered', () => {
  assert.equal(pushStatusLabel('on'), 'On');
  assert.equal(pushStatusLabel('off'), 'Off');
  assert.equal(pushStatusLabel('denied'), 'Off');
  assert.equal(pushStatusLabel('unsupported'), 'Off');
});

test('a denied phone offers the system settings; a simulator does not', () => {
  assert.equal(settingsAction('denied', 'ios'), 'Open iOS Settings');
  assert.equal(settingsAction('denied', 'android'), 'Open Settings');
  assert.equal(settingsAction('off', 'ios'), null);
  assert.equal(settingsAction('on', 'ios'), null);
});

test('a launch registers only when permission is already granted and this user did not turn them off', () => {
  assert.equal(shouldAutoRegister({ permission: 'granted', suppressed: false }), true);
  assert.equal(shouldAutoRegister({ permission: 'granted', suppressed: true }), false);
  assert.equal(shouldAutoRegister({ permission: 'denied', suppressed: false }), false);
  assert.equal(shouldAutoRegister({ permission: 'undetermined', suppressed: false }), false);
});

test('a token failure keeps the underlying message', () => {
  assert.match(pushFailureMessage(new Error('No "projectId" found.')), /projectId/);
  assert.match(pushFailureMessage('no valid aps-environment'), /aps-environment/);
  assert.match(pushFailureMessage(null), /could not register/i);
});
