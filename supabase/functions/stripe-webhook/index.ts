import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(
  Deno.env.get('STRIPE_SECRET_KEY')!
);

const cryptoProvider =
  Stripe.createSubtleCryptoProvider();

Deno.serve(async (request) => {
  const signature =
    request.headers.get('Stripe-Signature');

  if (!signature) {
    return new Response(
      'Missing Stripe signature',
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event =
      await stripe.webhooks.constructEventAsync(
        await request.text(),
        signature,
        Deno.env.get(
          'STRIPE_WEBHOOK_SIGNING_SECRET'
        )!,
        undefined,
        cryptoProvider
      );
  } catch (error) {
    console.error(
      'Stripe signature verification failed:',
      error
    );

    return new Response(
      'Invalid webhook signature',
      { status: 400 }
    );
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY'
      )!
    );

    if (event.type === 'account.updated') {
      const account =
        event.data.object as Stripe.Account;

      const { error } = await admin
        .from('contractor_profiles')
        .update({
          stripe_charges_enabled:
            Boolean(account.charges_enabled),
          stripe_details_submitted:
            Boolean(account.details_submitted),
          updated_at: new Date().toISOString()
        })
        .eq('stripe_account_id', account.id);

      if (error) throw error;
    }

    if (
      event.type ===
        'checkout.session.completed' ||
      event.type ===
        'checkout.session.async_payment_succeeded' ||
      event.type ===
        'checkout.session.async_payment_failed'
    ) {
      const session =
        event.data.object as Stripe.Checkout.Session;

      const orderId =
        session.metadata?.fieldsign_order_id;

      if (!orderId) {
        throw new Error(
          'Checkout Session is missing its order ID.'
        );
      }

      const connectedAccountId =
        typeof event.account === 'string'
          ? event.account
          : null;

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || null;

      const { error } = await admin.rpc(
        'fieldsign_process_checkout_event',
        {
          p_event_id: event.id,
          p_event_type: event.type,
          p_order_id: orderId,
          p_session_id: session.id,
          p_payment_intent_id:
            paymentIntentId,
          p_connected_account_id:
            connectedAccountId,
          p_amount_total:
            session.amount_total,
          p_currency: session.currency,
          p_payment_status:
            session.payment_status
        }
      );

      if (error) throw error;
    }

    return Response.json({
      received: true
    });
  } catch (error) {
    console.error(
      'Stripe webhook processing failed:',
      error
    );

    // A non-2xx response tells Stripe to retry.
    return new Response(
      'Webhook processing failed',
      { status: 500 }
    );
  }
});
