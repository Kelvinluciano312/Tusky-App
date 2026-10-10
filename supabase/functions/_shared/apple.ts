import { createRemoteJWKSet, importPKCS8, type JWTVerifyGetKey, jwtVerify, SignJWT } from 'npm:jose@5';

// Sign in with Apple, the server side (Phase 17): checking the identity token the
// app sends to prove who is holding the phone, trading its authorization code for
// a refresh token, revoking that token when an account is deleted (App Store
// Guideline 5.1.1(v)), and reading Apple's server-to-server notifications.
// Nothing here logs a token, a code, or the private key.

export const APPLE_ISSUER = 'https://appleid.apple.com';
/** The iOS bundle id is Apple's client id for a native app. Not a secret (like ANDROID_PACKAGE). */
export const APPLE_BUNDLE_ID = 'com.ouroborosstudios.tusky';

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

/** What Apple's token endpoints need: the Team ID, and the Sign in with Apple key (P3) with its id. */
export type AppleEnv = { teamId: string; keyId: string; privateKey: string };

/** The three secrets, or null when any is missing (revocation is then skipped with a warning). */
export function appleEnv(get: (key: string) => string | undefined): AppleEnv | null {
  const teamId = get('APPLE_TEAM_ID');
  const keyId = get('APPLE_KEY_ID');
  const privateKey = get('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !privateKey) return null;
  // Secrets set from a one-line shell variable carry literal "\n" instead of line breaks.
  return { teamId, keyId, privateKey: privateKey.replace(/\\n/g, '\n') };
}

let remoteKeys: JWTVerifyGetKey | null = null;
function appleKeys(): JWTVerifyGetKey {
  remoteKeys ??= createRemoteJWKSet(new URL(APPLE_KEYS_URL));
  return remoteKeys;
}

type VerifyOptions = { keys?: JWTVerifyGetKey; now?: Date };

/**
 * Apple's identity token is for this app, at most 10 minutes old, and for this
 * Apple user (`expectedSub`, read from the user's Apple identity). Never throws:
 * false on anything off.
 */
export async function verifyAppleIdentity(token: string, expectedSub: string, opts: VerifyOptions = {}): Promise<boolean> {
  if (!token || !expectedSub) return false;
  try {
    const { payload } = await jwtVerify(token, opts.keys ?? appleKeys(), {
      issuer: APPLE_ISSUER,
      audience: APPLE_BUNDLE_ID,
      algorithms: ['RS256'],
      maxTokenAge: '10m',
      currentDate: opts.now,
    });
    return payload.sub === expectedSub;
  } catch {
    return false;
  }
}

/** The ES256 JWT that stands in for a client secret when calling Apple's token endpoints; good for 5 minutes. */
export async function appleClientSecret(env: AppleEnv, now: Date): Promise<string> {
  const key = await importPKCS8(env.privateKey, 'ES256');
  const iat = Math.floor(now.getTime() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.keyId })
    .setIssuer(env.teamId)
    .setSubject(APPLE_BUNDLE_ID)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(key);
}

export type FormPost = (url: string, form: Record<string, string>) => Promise<{ status: number; body: unknown }>;

/** The real POST: form-encoded, 10 seconds at most, the body read as JSON when it is. */
export const formPost: FormPost = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

/**
 * Trades the authorization code from a fresh Apple sign-in for a refresh token.
 * The code is single-use and expires in 5 minutes, so call this right away. Null
 * when Apple refuses or cannot be reached; never throws.
 */
export async function exchangeAppleCode(post: FormPost, env: AppleEnv, code: string, now: Date): Promise<string | null> {
  try {
    const { status, body } = await post(APPLE_TOKEN_URL, {
      client_id: APPLE_BUNDLE_ID,
      client_secret: await appleClientSecret(env, now),
      code,
      grant_type: 'authorization_code',
    });
    const token = (body as { refresh_token?: unknown } | null)?.refresh_token;
    return status === 200 && typeof token === 'string' && token !== '' ? token : null;
  } catch {
    return null;
  }
}

/** Ends Tusky's grant on the person's Apple ID: it disappears from Settings > Sign in with Apple. True when Apple said 200. */
export async function revokeAppleToken(post: FormPost, env: AppleEnv, refreshToken: string, now: Date): Promise<boolean> {
  try {
    const { status } = await post(APPLE_REVOKE_URL, {
      client_id: APPLE_BUNDLE_ID,
      client_secret: await appleClientSecret(env, now),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Apple's server-to-server notification: a JWS signed by Apple whose `events`
 * claim is itself a JSON string. Returns the event type and the Apple user, or
 * null when the signature, issuer or audience is off or the event is unreadable.
 * The endpoint is public, so this IS its auth. No age limit: Apple retries a
 * delivery, and an old genuine one only ends sessions it should have ended.
 */
export async function verifyAppleNotification(
  signed: string,
  opts: VerifyOptions = {},
): Promise<{ type: string; sub: string } | null> {
  try {
    const { payload } = await jwtVerify(signed, opts.keys ?? appleKeys(), {
      issuer: APPLE_ISSUER,
      audience: APPLE_BUNDLE_ID,
      algorithms: ['RS256'],
      currentDate: opts.now,
    });
    if (typeof payload.events !== 'string') return null;
    const event = JSON.parse(payload.events) as { type?: unknown; sub?: unknown };
    if (typeof event?.type !== 'string' || typeof event.sub !== 'string' || event.sub === '') return null;
    return { type: event.type, sub: event.sub };
  } catch {
    return null;
  }
}
