import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const appUrl = new URL(Deno.env.get('APP_URL')!).origin + '/';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action ?? 'open';
    if (action !== 'open' && action !== 'status') return jsonResponse({ error: 'Invalid action' }, 400);
    const authorization = request.headers.get('Authorization');
    if (!authorization) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: profile, error: profileError } = await admin
      .from('contractor_profiles')
      .select('stripe_account_id, company_name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (action === 'status' && !profile?.stripe_account_id) {
      return jsonResponse({ user_id: user.id, account_id: null, charges_enabled: false, details_submitted: false });
    }
    if (!profile) return jsonResponse({ error: 'Save your business profile before connecting Stripe.' }, 409);

    let accountId = profile.stripe_account_id as string | null;
    if (!accountId) {
  const account = await stripe.v2.core.accounts.create(
    {
      contact_email: user.email || undefined,
      display_name:
        profile.company_name ||
        user.email ||
        'SignForth Contractor',
      dashboard: 'full',
      identity: {
        country: 'us',
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: {
              requested: true,
            },
          },
        },
      },
      defaults: {
        currency: 'usd',
        responsibilities: {
          fees_collector: 'stripe',
          losses_collector: 'stripe',
        },
      },
      metadata: {
        fieldsign_user_id: user.id,
      },
    },
    {
      idempotencyKey:
        `signforth-connected-account-${user.id}`,
    },
  );

  accountId = account.id;

  const { error } = await admin
    .from('contractor_profiles')
    .update({
      stripe_account_id: accountId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) throw error;
}
    // Never trust a browser-provided account ID or silently adopt a legacy association.
    const coreAccount = await stripe.v2.core.accounts.retrieve(accountId);
    if (coreAccount.metadata?.fieldsign_user_id !== user.id) {
      console.error('Stripe ownership mismatch for authenticated user', user.id);
      return jsonResponse({ error: 'Stripe account ownership could not be verified. Contact support.' }, 409);
    }
    const account = await stripe.accounts.retrieve(accountId);
    const chargesEnabled = Boolean(account.charges_enabled);
    const detailsSubmitted = Boolean(account.details_submitted);
    const { error: statusUpdateError } = await admin
  .from('contractor_profiles')
  .update({
    stripe_charges_enabled: chargesEnabled,
    stripe_details_submitted: detailsSubmitted,
    updated_at: new Date().toISOString(),
  })
  .eq('user_id', user.id)
  .eq('stripe_account_id', accountId);

if (statusUpdateError) {
  throw statusUpdateError;
}
    const status = { user_id: user.id, account_id: accountId, charges_enabled: chargesEnabled, details_submitted: detailsSubmitted };
    if (action === 'status') return jsonResponse(status);
    if (chargesEnabled && detailsSubmitted) {
      // Full-dashboard accounts sign in at Stripe; Express login links are not supported.
      return jsonResponse({ ...status, status: 'connected', url: 'https://dashboard.stripe.com/login' });
    }

    const link = await stripe.v2.core.accountLinks.create({
  account: accountId,
  use_case: {
    type: 'account_onboarding',
    account_onboarding: {
      configurations: ['merchant'],
      refresh_url: `${appUrl}?stripe=refresh`,
      return_url: `${appUrl}?stripe=return`,
    },
  },
});
    return jsonResponse({ ...status, status: 'onboarding', url: link.url });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: 'Unable to start Stripe onboarding' }, 500);
  }
});
