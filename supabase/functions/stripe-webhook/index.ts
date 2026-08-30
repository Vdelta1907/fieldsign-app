import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (request) => {
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing Stripe signature', { status: 400 });

  try {
    const event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!,
      undefined,
      cryptoProvider,
    );

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      const { error } = await admin.from('contractor_profiles').update({
        stripe_charges_enabled: Boolean(account.charges_enabled),
        stripe_details_submitted: Boolean(account.details_submitted),
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', account.id);
      if (error) throw error;
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded' ||
      event.type === 'checkout.session.async_payment_failed'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.fieldsign_order_id;
      if (orderId) {
        const nextStatus = event.type === 'checkout.session.async_payment_failed'
          ? 'failed'
          : session.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded'
            ? 'paid'
            : 'pending';

        const { error } = await admin.from('orders').update({
          payment_status: nextStatus,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          updated_at: new Date().toISOString(),
        }).eq('id', orderId).eq('stripe_checkout_session_id', session.id);
        if (error) throw error;
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error(error);
    return new Response('Invalid webhook', { status: 400 });
  }
});
