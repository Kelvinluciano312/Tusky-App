// Whether this phone should be registered, and what Settings says about it.
// Pure. The Expo calls and the push_tokens write live in push.ts.

/** EAS project. Passed to getExpoPushTokenAsync when the embedded manifest has no id. */
export const EAS_PROJECT_ID = 'd03876ea-66da-42a2-9b9c-d17309acca6b';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type PushMasterState = 'on' | 'off' | 'denied' | 'unsupported';

const IOS_DENIED = 1;
const IOS_AUTHORIZED = 2;
const IOS_PROVISIONAL = 3;
const IOS_EPHEMERAL = 4;

/**
 * Manifest first, then the id baked into this app. An empty string is missing:
 * getExpoPushTokenAsync treats a passed `undefined` as "look at Constants", and
 * on an iOS release build those can both be empty, so the call throws before
 * any token is saved.
 */
export function resolveProjectId(
  expoConfigId?: string | null,
  easConfigId?: string | null,
): string {
  const fromManifest = expoConfigId?.trim() || easConfigId?.trim();
  return fromManifest || EAS_PROJECT_ID;
}

/**
 * iOS reports provisional and ephemeral on `ios.status`, and the root `granted`
 * flag stays false for both. Either is enough to register a token. Denied is
 * the only state that needs the system Settings app.
 */
export function permissionFromSettings(settings: {
  granted: boolean;
  status?: string;
  iosStatus?: number | null;
}): PushPermission {
  const ios = settings.iosStatus;
  if (
    settings.granted
    || ios === IOS_AUTHORIZED
    || ios === IOS_PROVISIONAL
    || ios === IOS_EPHEMERAL
  ) {
    return 'granted';
  }
  if (settings.status === 'denied' || ios === IOS_DENIED) return 'denied';
  return 'undetermined';
}

/** On means the OS allowed notifications and this device's token is stored. */
export function pushMasterState(input: {
  permission: PushPermission;
  tokenRegistered: boolean;
}): PushMasterState {
  if (input.permission === 'unsupported') return 'unsupported';
  if (input.permission === 'denied') return 'denied';
  if (input.permission === 'granted' && input.tokenRegistered) return 'on';
  return 'off';
}

export function pushStatusLabel(state: PushMasterState): 'On' | 'Off' {
  return state === 'on' ? 'On' : 'Off';
}

/** The system-settings button, or null when the in-app switch can change it. */
export function settingsAction(state: PushMasterState, platform: string): string | null {
  if (state !== 'denied') return null;
  return platform === 'ios' ? 'Open iOS Settings' : 'Open Settings';
}

/** Cold start re-registers only a phone the person has not turned off. */
export function shouldAutoRegister(input: { permission: PushPermission; suppressed: boolean }): boolean {
  return input.permission === 'granted' && !input.suppressed;
}

/** The message under the switch, and in the log. Keeps Expo's own reason. */
export function pushFailureMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return 'Could not register this phone for notifications.';
}
