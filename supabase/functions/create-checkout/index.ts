import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const appUrl = Deno.env.get('APP_URL')!;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { signingToken } = await request.json();
    if (typeof signingToken !== 'string') return jsonResponse({ error: 'Invalid signing token' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, owner_id, order_type, project_title, client_name, cost, status, payment_status, require_payment_upfront')
      .eq('signing_token', signingToken)
      .is('archived_at', null)
      .single();
    if (orderError || !order) return jsonResponse({ error: 'Order not found' }, 404);
    if (order.status !== 'signed' || order.payment_status !== 'pending' || !order.require_payment_upfront) {
      return jsonResponse({ error: 'This order is not eligible for payment' }, 409);
    }

    const { data: profile, error: profileError } = await admin
      .from('contractor_profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('user_id', order.owner_id)
      .single();
    if (profileError || !profile?.stripe_account_id || !profile.stripe_charges_enabled) {
      return jsonResponse({ error: 'Contractor payments are not available' }, 409);
    }

    const unitAmount = Math.round(Number(order.cost) * 100);
    if (!Number.isSafeInteger(unitAmount) || unitAmount < 50) {
      return jsonResponse({ error: 'Invalid payment amount' }, 400);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: order.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: {
            name: `${order.order_type}: ${order.project_title}`.slice(0, 120),
            description: `Authorized by ${order.client_name}`.slice(0, 500),
          },
        },
      }],
      metadata: { fieldsign_order_id: order.id },
      payment_intent_data: { metadata: { fieldsign_order_id: order.id } },
      success_url: `${appUrl}?sign=${encodeURIComponent(signingToken)}&payment=success`,
      cancel_url: `${appUrl}?sign=${encodeURIComponent(signingToken)}&payment=cancelled`,
    }, {
      stripeAccount: profile.stripe_account_id,
      idempotencyKey: `fieldsign-checkout-${order.id}`,
    });

    const { error: updateError } = await admin.from('orders').update({
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);
    if (updateError) throw updateError;

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: 'Unable to create secure checkout' }, 500);
  }
});
