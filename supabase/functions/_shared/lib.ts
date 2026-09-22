import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { Configuration, PlaidApi, PlaidEnvironments } from 'npm:plaid@30';

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

/** Service-role client — bypasses RLS. Only for use inside Edge Functions. */
export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Resolve the calling user from the request's JWT; null if invalid. */
export async function getAuthedUser(req: Request, admin: SupabaseClient): Promise<User | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await admin.auth.getUser(authHeader.slice('Bearer '.length));
  if (error) return null;
  return data.user;
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
