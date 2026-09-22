import { timingSafeEqual } from 'node:crypto';
import { decodeProtectedHeader, importJWK, type JWK, jwtVerify } from 'npm:jose@5';

/** A key from /webhook_verification_key/get: a public JWK plus Plaid's expiry. */
export type PlaidJwk = JWK & { expired_at?: number | null };

export type PlaidWebhookBody = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  environment?: string;
  error?: { error_code?: string } | null;
};

export type WebhookAction = 'sync' | 'login_required' | 'ignore';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Plaid's webhook verification. The endpoint is public, so this IS its auth:
 * an ES256 JWT in the Plaid-Verification header, signed by a key we fetch by
 * `kid`, at most 5 minutes old (replay guard), whose `request_body_sha256`
 * claim matches the raw body byte for byte. Never throws — false on anything off.
 *
 * `rawBody` must be the request text exactly as received: Plaid hashes its own
 * 2-space-indented serialization, so re-serializing parsed JSON breaks the hash.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  token: string | null,
  getKey: (kid: string) => Promise<PlaidJwk | null>,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { alg, kid } = decodeProtectedHeader(token);
    if (alg !== 'ES256' || !kid) return false;

    const jwk = await getKey(kid);
    if (!jwk || jwk.expired_at) return false;

    // Only the curve point: Plaid's extra members (use, created_at, …) are not
    // WebCrypto's business.
    const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, 'ES256');
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['ES256'],
      maxTokenAge: '5m',
      clockTolerance: '30s', // Plaid's clock and ours are not the same clock
    });

    const claimed = payload.request_body_sha256;
    if (typeof claimed !== 'string') return false;
    const actual = new TextEncoder().encode(await sha256Hex(rawBody));
    const expected = new TextEncoder().encode(claimed);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * What an authentic webhook asks of us. Deliberately narrow: PENDING_DISCONNECT
 * and PENDING_EXPIRATION are NOT login_required — the credentials still work in
 * that window, so the next successful sync would flip the Item back to active
 * and the Reconnect prompt would flap. ITEM_LOGIN_REQUIRED fires when access
 * actually lapses.
 */
export function classifyWebhook(body: PlaidWebhookBody): WebhookAction {
  switch (`${body.webhook_type}/${body.webhook_code}`) {
    case 'TRANSACTIONS/SYNC_UPDATES_AVAILABLE':
    case 'ITEM/LOGIN_REPAIRED': // a successful sync is what returns an Item to active
      return 'sync';
    case 'ITEM/ERROR':
      return body.error?.error_code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'ignore';
    default:
      return 'ignore';
  }
}
