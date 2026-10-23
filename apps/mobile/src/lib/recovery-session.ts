// Turning a reset link into a session, and remembering that the person still
// has to choose a password. The gate reads `isRecovering` so a recovery
// session never falls through into the app or the two-step screen first.

import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import {
  parseRecoveryUrl,
  recoveryExchangeMessage,
  type RecoveryLink,
} from '@/lib/recovery';
import { supabase } from '@/lib/supabase';

let recovering = false;
let ready = false;
let problem: string | null = null;
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<string | null | undefined>>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function isRecovering(): boolean {
  return recovering;
}

export function recoveryProblem(): string | null {
  return problem;
}

/** True once a recovery session exists and the person can choose a password. */
export function recoveryReady(): boolean {
  return ready;
}

export function setRecovering(next: boolean, nextProblem: string | null = null): void {
  recovering = next;
  problem = next ? nextProblem : null;
  if (!next) ready = false;
  emit();
}

function markReady(): void {
  ready = true;
  recovering = true;
  problem = null;
  emit();
}

export function onRecoveringChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecovering(): { recovering: boolean; ready: boolean; problem: string | null } {
  const [state, setState] = useState({
    recovering: isRecovering(),
    ready: recoveryReady(),
    problem: recoveryProblem(),
  });
  useEffect(() => onRecoveringChange(() => {
    setState({ recovering: isRecovering(), ready: recoveryReady(), problem: recoveryProblem() });
  }), []);
  return state;
}

async function applyLink(link: RecoveryLink): Promise<string | null> {
  if (link.kind === 'token_hash') {
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: 'recovery' });
    return recoveryExchangeMessage(error);
  }
  if (link.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(link.code);
    return recoveryExchangeMessage(error);
  }
  if (link.kind === 'session') {
    const { error } = await supabase.auth.setSession({
      access_token: link.accessToken,
      refresh_token: link.refreshToken,
    });
    return recoveryExchangeMessage(error);
  }
  return 'Request a new reset email and enter its code on that screen.';
}

/**
 * Undefined when the URL is not a reset link. Null when a session was created.
 * A string is the message to show, and the reset screen stays up so it can.
 */
export function applyRecoveryUrl(url: string): Promise<string | null | undefined> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const pending = applyOnce(url).then((result) => {
    if (result) inflight.delete(url);
    return result;
  });
  inflight.set(url, pending);
  return pending;
}

async function applyOnce(url: string): Promise<string | null | undefined> {
  const link = parseRecoveryUrl(url);
  if (!link) return undefined;
  // Not ready yet: an existing sign-in must not see the new-password form
  // while the link is still being checked, or after it fails.
  ready = false;
  setRecovering(true, null);
  const message = await applyLink(link);
  if (message) {
    ready = false;
    setRecovering(true, message);
  } else {
    markReady();
  }
  return message;
}

/** Deep links and the PASSWORD_RECOVERY event. One subscription for the root layout. */
export function listenForRecovery(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') markReady();
  });
  const handle = (url: string | null) => {
    if (url) void applyRecoveryUrl(url);
  };
  const subscription = Linking.addEventListener('url', ({ url }) => handle(url));
  void Linking.getInitialURL().then(handle).catch((error: unknown) => {
    console.error('[recovery]', error instanceof Error ? error.message : error);
  });
  return () => {
    data.subscription.unsubscribe();
    subscription.remove();
  };
}
