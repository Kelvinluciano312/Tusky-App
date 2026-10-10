import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { appleCanceled, appleDisplayName, appleSub } from '@/lib/apple';
import { validatePersonName } from '@/lib/profile';
import { useIdentities } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

export type AppleSignInResult =
  | { status: 'canceled' }
  | { status: 'signed_in'; userId: string; name: string | null };

/**
 * Apple embeds the SHA-256 of the nonce in the identity token; Supabase wants the
 * raw nonce back and hashes it itself, which is what proves the token is ours.
 * Apple sends the person's name only on their first sign-in, so the caller saves it now.
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (err) {
    if (appleCanceled(err)) return { status: 'canceled' };
    throw err;
  }

  if (!credential.identityToken) throw new Error('Apple did not return a sign-in token. Try again.');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error || !data.user) throw error ?? new Error('Sign in with Apple failed.');

  return {
    status: 'signed_in',
    userId: data.user.id,
    name: validatePersonName(appleDisplayName(credential.fullName) ?? ''),
  };
}

/**
 * Keeps the name Apple shared as the profile name. Only before onboarding: an
 * existing account that links Apple later keeps the name it already chose.
 * Best effort, because onboarding asks for the name again.
 */
export async function saveAppleName(userId: string, name: string): Promise<void> {
  await supabase.from('profiles').update({ display_name: name }).eq('user_id', userId).is('onboarded_at', null);
}

/**
 * A fresh Apple proof for deleting an account: the identity token shows who is
 * holding the phone, the authorization code lets the server revoke Apple's grant.
 * Null when the person cancels.
 */
export async function confirmWithApple(): Promise<{ identity_token: string; authorization_code: string } | null> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
  } catch (err) {
    if (appleCanceled(err)) return null;
    throw err;
  }
  if (!credential.identityToken || !credential.authorizationCode) {
    throw new Error('Apple did not confirm it’s you. Nothing was deleted.');
  }
  return { identity_token: credential.identityToken, authorization_code: credential.authorizationCode };
}

/**
 * Someone who stops using Sign in with Apple for Tusky (iOS Settings > Apple
 * Account) is signed out the next time the app opens. Only REVOKED counts:
 * NOT_FOUND also means this phone's Apple ID is not the linked one, and an
 * error (the simulator always throws) is not a revocation.
 */
export function useAppleCredentialWatch(userId: string | undefined) {
  const queryClient = useQueryClient();
  const { data: identities } = useIdentities(Platform.OS === 'ios' ? userId : undefined);
  const sub = appleSub(identities);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !sub) return;
    let alive = true;
    const check = async () => {
      try {
        const state = await AppleAuthentication.getCredentialStateAsync(sub);
        if (alive && state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED) {
          await supabase.auth.signOut();
          queryClient.clear();
        }
      } catch {
        // Not a revocation: leave the session alone.
      }
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [sub, queryClient]);
}

/** True on an iPhone or iPad that can show Apple's sheet; always false on Android. */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (alive) setAvailable(ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
