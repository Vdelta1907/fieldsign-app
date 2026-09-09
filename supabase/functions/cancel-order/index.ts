import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripeSecretKey =
  Deno.env.get('STRIPE_SECRET_KEY');

const supabaseUrl =
  Deno.env.get('SUPABASE_URL');

const serviceRoleKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const appUrl =
  Deno.env.get('APP_URL');

if (
  !stripeSecretKey ||
  !supabaseUrl ||
  !serviceRoleKey ||
  !appUrl
) {
  throw new Error(
    'Required server configuration is missing.',
  );
}

const stripe = new Stripe(stripeSecretKey);
const allowedOrigin = new URL(appUrl).origin;

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
    );
  }

  try {
    const authorization =
      request.headers.get('Authorization');

    if (
      !authorization ||
      !authorization.startsWith('Bearer ')
    ) {
      return jsonResponse(
        { error: 'Authentication is required' },
        401,
      );
    }

    const accessToken =
      authorization.slice('Bearer '.length).trim();

    if (!accessToken) {
      return jsonResponse(
        { error: 'Authentication is required' },
        401,
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !user) {
      return jsonResponse(
        { error: 'Your session is no longer valid' },
        401,
      );
    }

    const body = await request.json();
    const orderId = body?.orderId;

    if (
      typeof orderId !== 'string' ||
      !uuidPattern.test(orderId)
    ) {
      return jsonResponse(
        { error: 'Invalid order ID' },
        400,
      );
    }

    const {
      data: order,
      error: orderError,
    } = await admin
      .from('orders')
      .select(`
        id,
        owner_id,
        status,
        payment_status,
        cancelled_at,
        stripe_checkout_session_id
      `)
      .eq('id', orderId)
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .maybeSingle();

    if (orderError) {
      throw orderError;
    }

    if (!order) {
      return jsonResponse(
        { error: 'Order not found' },
        404,
      );
    }

    if (order.status === 'cancelled') {
      return jsonResponse({
        order_id: order.id,
        status: order.status,
        cancelled_at: order.cancelled_at,
        already_cancelled: true,
      });
    }

    if (
      order.status !== 'pending' &&
      order.status !== 'changes_requested'
    ) {
      return jsonResponse(
        {
          error:
            'Only Pending or Changes Requested orders can be cancelled.',
        },
        409,
      );
    }

    if (order.payment_status === 'paid') {
      return jsonResponse(
        {
          error:
            'Payment has already completed. Refresh the order before continuing.',
        },
        409,
      );
    }

    let expiredCheckoutSessionId:
      | string
      | null = null;

    if (order.stripe_checkout_session_id) {
      const {
        data: profile,
        error: profileError,
      } = await admin
        .from('contractor_profiles')
        .select('stripe_account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (
        profileError ||
        !profile?.stripe_account_id
      ) {
        return jsonResponse(
          {
            error:
              'The associated Stripe Checkout Session could not be safely closed.',
          },
          409,
        );
      }

      const stripeAccount =
        profile.stripe_account_id;

      const checkoutSession =
        await stripe.checkout.sessions.retrieve(
          order.stripe_checkout_session_id,
          {},
          { stripeAccount },
        );

      if (
        checkoutSession.payment_status === 'paid' ||
        checkoutSession.status === 'complete'
      ) {
        return jsonResponse(
          {
            error:
              'Payment has already completed or is processing. Refresh the order before continuing.',
          },
          409,
        );
      }

      if (checkoutSession.status === 'open') {
        await stripe.checkout.sessions.expire(
          checkoutSession.id,
          {},
          { stripeAccount },
        );
      }

      if (
        checkoutSession.status === 'open' ||
        checkoutSession.status === 'expired'
      ) {
        expiredCheckoutSessionId =
          checkoutSession.id;
      } else {
        return jsonResponse(
          {
            error:
              'The Stripe Checkout Session could not be safely closed.',
          },
          409,
        );
      }
    }

    const {
      data: cancellation,
      error: cancellationError,
    } = await admin.rpc(
      'fieldsign_cancel_order',
      {
        p_order_id: order.id,
        p_owner_id: user.id,
        p_expired_checkout_session_id:
          expiredCheckoutSessionId,
      },
    );

    if (cancellationError) {
      console.error(
        'Order cancellation rejected:',
        cancellationError,
      );

      return jsonResponse(
        {
          error:
            cancellationError.message ||
            'The order could not be cancelled.',
        },
        409,
      );
    }

    return jsonResponse(cancellation);
  } catch (error) {
    console.error(
      'Cancel order error:',
      error,
    );

    return jsonResponse(
      {
        error:
          'The order could not be cancelled securely.',
      },
      500,
    );
  }
});