import { createClient } from 'npm:@supabase/supabase-js@2';
const configuredAppUrl = Deno.env.get('APP_URL');

if (!configuredAppUrl) {
  throw new Error('APP_URL is not configured.');
}

const allowedOrigin = new URL(configuredAppUrl).origin;

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
const url = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in again.' }, 401);
  const caller = createClient(url, publicKey, { ...options, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user?.email) return jsonResponse({ error: 'Sign in again.' }, 401);
  const verified = createClient(url, publicKey, options);
  try {
    const body = await request.json();
    if (!['email', 'password', 'request-deletion'].includes(body.action) ||
        typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 4096) {
      return jsonResponse({ error: 'Enter your current password and a valid action.' }, 400);
    }
    // This password check runs on the server and is tied to the bearer-token user.
    // Supabase Auth rate limits password attempts. Never log request bodies.
    const { data, error } = await verified.auth.signInWithPassword({ email: user.email, password: body.currentPassword });
    if (error || data.user?.id !== user.id || !data.session) {
      return jsonResponse({ error: 'Your identity could not be verified. Check your current password and retry.' }, 403);
    }
    if (body.action === 'email') {
      if (typeof body.email !== 'string' || body.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return jsonResponse({ error: 'Enter a valid new email address.' }, 400);
      }
      if (body.email.toLowerCase() === user.email.toLowerCase()) return jsonResponse({ error: 'Enter a different email address.' }, 400);
      const origin = new URL(Deno.env.get('APP_URL')!).origin;
      const { error: updateError } = await verified.auth.updateUser({ email: body.email }, { emailRedirectTo: `${origin}/?email-verified=1` });
      if (updateError) return jsonResponse({ error: 'The email change could not be requested. Please retry.' }, 400);
      return jsonResponse({ message: 'Check your current and new inboxes for verification instructions. Your business contact email is unchanged.' });
    }
    if (body.action === 'password') {
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 4096 || body.password === body.currentPassword) {
        return jsonResponse({ error: 'Choose a different password with at least 8 characters.' }, 400);
      }
      const { error: updateError } = await verified.auth.updateUser({ password: body.password });
      if (updateError) return jsonResponse({ error: 'The password could not be updated. Check password requirements and retry.' }, 400);
      const { error: logoutError } = await verified.auth.signOut({ scope: 'global' });
      if (logoutError) return jsonResponse({ message: 'Password updated. Sign out on your devices to complete session cleanup.' });
      return jsonResponse({ message: 'Password updated. Sign in again with your new password.' });
    }
    if (body.confirmation !== 'DELETE') return jsonResponse({ error: 'Type DELETE to confirm.' }, 400);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
    const { error: requestError } = await admin.from('account_deletion_requests').upsert(
      { user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true },
    );
    if (requestError) throw requestError;
    return jsonResponse({ message: 'Your account deletion request has been recorded for review. Your account remains active until the review is completed.' });
  } catch {
    return jsonResponse({ error: 'The account request could not be completed. Please retry.' }, 500);
  } finally {
    // Dispose of the temporary password-verification session, never another user's session.
    await verified.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
});
