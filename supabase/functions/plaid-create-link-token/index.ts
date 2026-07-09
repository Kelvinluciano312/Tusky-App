import { CountryCode, Products } from 'npm:plaid@30';

import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const plaid = getPlaidClient();
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Tusky',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      // Required for the native Android Link SDK; must also be registered as an
      // Allowed Android package name in the Plaid dashboard (API settings).
      android_package_name: 'com.tusky.app',
    });

    return jsonResponse({ link_token: data.link_token, expiration: data.expiration });
  } catch (err) {
    console.error('linkTokenCreate failed', err);
    return jsonResponse({ error: 'Failed to create link token' }, 500);
  }
});
