import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(
  Deno.env.get('STRIPE_SECRET_KEY')!
);

const appUrl = Deno.env.get('APP_URL');

if (!appUrl) {
  throw new Error('APP_URL is not configured.');
}

const allowedOrigin = new URL(appUrl).origin;

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

const jsonResponse = (
  body: unknown,
  status = 200,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const { signingToken } = await request.json();

    if (typeof signingToken !== 'string' || !signingToken.trim()) {
      return jsonResponse({ error: 'Invalid signing token' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select(`
        id,
        owner_id,
        order_type,
        project_title,
        client_name,
        cost,
        status,
        payment_status,
        require_payment_upfront,
        stripe_checkout_session_id
      `)
      .eq('signing_token', signingToken)
      .is('archived_at', null)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: 'Order not found' }, 404);
    }

    const paymentCanBeAttempted =
      order.payment_status === 'pending' ||
      order.payment_status === 'failed';

    if (
      order.status !== 'signed' ||
      !paymentCanBeAttempted ||
      !order.require_payment_upfront
    ) {
      return jsonResponse(
        { error: 'This order is not eligible for payment' },
        409,
      );
    }

    const { data: profile, error: profileError } = await admin
      .from('contractor_profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('user_id', order.owner_id)
      .single();

    if (
      profileError ||
      !profile?.stripe_account_id ||
      !profile.stripe_charges_enabled
    ) {
      return jsonResponse(
        { error: 'Contractor payments are not available' },
        409,
      );
    }

    const stripeAccount = profile.stripe_account_id;
    const previousSessionId =
      order.stripe_checkout_session_id || 'initial';

    if (order.stripe_checkout_session_id) {
      try {
        const existingSession =
          await stripe.checkout.sessions.retrieve(
            order.stripe_checkout_session_id,
            {},
            { stripeAccount },
          );

        if (
          existingSession.status === 'open' &&
          existingSession.url
        ) {
          return jsonResponse({
            url: existingSession.url,
            reused: true,
          });
        }

        if (existingSession.payment_status === 'paid') {
          return jsonResponse(
            { error: 'Payment has already been completed' },
            409,
          );
        }

        if (
          existingSession.status === 'complete' &&
          order.payment_status !== 'failed'
        ) {
          return jsonResponse(
            { error: 'Payment confirmation is still processing' },
            409,
          );
        }
      } catch (error) {
        const stripeError = error as { code?: string };

        if (stripeError.code !== 'resource_missing') {
          throw error;
        }
      }
    }

    const unitAmount = Math.round(Number(order.cost) * 100);

    if (!Number.isSafeInteger(unitAmount) || unitAmount < 50) {
      return jsonResponse({ error: 'Invalid payment amount' }, 400);
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: order.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: unitAmount,
              product_data: {
                name:
                  `${order.order_type}: ${order.project_title}`
                    .slice(0, 120),
                description:
                  `Authorized by ${order.client_name}`
                    .slice(0, 500),
              },
            },
          },
        ],
        metadata: {
          fieldsign_order_id: order.id,
        },
        payment_intent_data: {
          metadata: {
            fieldsign_order_id: order.id,
          },
        },
        success_url:
          `${appUrl}?sign=${encodeURIComponent(signingToken)}` +
          '&payment=success',
        cancel_url:
          `${appUrl}?sign=${encodeURIComponent(signingToken)}` +
          '&payment=cancelled',
      },
      {
        stripeAccount,
        idempotencyKey:
          `fieldsign-checkout-${order.id}-${previousSessionId}`,
      },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL');
    }

    const {
  data: updatedOrder,
  error: updateError,
} = await admin
  .from('orders')
  .update({
    stripe_checkout_session_id: session.id,
    payment_status: 'pending',
    updated_at: new Date().toISOString(),
  })
  .eq('id', order.id)
  .eq('status', 'signed')
  .eq('require_payment_upfront', true)
  .in('payment_status', ['pending', 'failed'])
  .select('id')
  .maybeSingle();

if (updateError) {
  throw updateError;
}

if (!updatedOrder) {
  try {
    await stripe.checkout.sessions.expire(
      session.id,
      {},
      { stripeAccount },
    );
  } catch (expirationError) {
    console.error(
      'Unable to expire stale Checkout Session:',
      expirationError,
    );
  }

  return jsonResponse(
    {
      error:
        'Payment status changed. Refresh before trying again.',
    },
    409,
  );
}

    return jsonResponse({
      url: session.url,
      reused: false,
    });
  } catch (error) {
    console.error('Checkout session error:', error);

    return jsonResponse(
      { error: 'Unable to create secure checkout' },
      500,
    );
  }
});
