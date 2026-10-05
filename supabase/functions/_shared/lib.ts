import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { Configuration, PlaidApi, PlaidEnvironments } from 'npm:plaid@30';

import { amrOfToken, secondStepRequired } from './two-factor.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Service-role client — bypasses RLS. Only for use inside Edge Functions.
 * New projects may ship only the new secret keys (a JSON map in
 * SUPABASE_SECRET_KEYS); older ones have the legacy service_role key.
 */
export function getAdminClient(): SupabaseClient {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = (secretKeys ? JSON.parse(secretKeys).default : null) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(Deno.env.get('SUPABASE_URL')!, key);
}

/**
 * The caller's herd (Phase 9b). Every user is in exactly one, created with
 * their account, so a missing row is a server fault, not a client error.
 */
export async function getCallerHerd(
  admin: SupabaseClient,
  userId: string,
): Promise<{ herd_id: string; role: 'owner' | 'member' }> {
  const { data, error } = await admin
    .from('herd_members').select('herd_id, role').eq('user_id', userId).single();
  if (error || !data) throw new Error(`no herd for user ${userId}`);
  return data as { herd_id: string; role: 'owner' | 'member' };
}

/** Resolve the calling user from the request's JWT; null if invalid. */
export async function getAuthedUser(req: Request, admin: SupabaseClient): Promise<User | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await admin.auth.getUser(authHeader.slice('Bearer '.length));
  if (error) return null;
  return data.user;
}

/**
 * Two-step sign-in (16e). The database already gives a password-only session
 * no herd (private.my_herd_id); functions run as the service role, so they ask
 * the same question here. Call it right after getAuthedUser: it returns the
 * response to send (403 two_factor_required) or null when the caller may go on.
 * The token was validated by getAuthedUser, so its claims can be trusted.
 */
export async function requireSecondStep(
  admin: SupabaseClient,
  req: Request,
  userId: string,
): Promise<Response | null> {
  const { data, error } = await admin.from('profiles').select('two_factor').eq('user_id', userId).maybeSingle();
  if (error) return jsonResponse({ error: 'two_factor_check_failed' }, 500);
  const token = (req.headers.get('Authorization') ?? '').slice('Bearer '.length);
  if (secondStepRequired(data?.two_factor as boolean | null | undefined, amrOfToken(token))) {
    return jsonResponse({ error: 'two_factor_required' }, 403);
  }
  return null;
}

/** Where Plaid delivers webhooks. Derived, so there is no secret to keep in sync. */
export function getWebhookUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/plaid-webhook`;
}

export function getPlaidClient(): PlaidApi {
  const env = Deno.env.get('PLAID_ENV') ?? 'sandbox';
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': Deno.env.get('PLAID_CLIENT_ID')!,
          'PLAID-SECRET': Deno.env.get('PLAID_SECRET')!,
        },
      },
    }),
  );
}
