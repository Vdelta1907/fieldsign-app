import { createClient } from 'npm:@supabase/supabase-js@2';
import { prepareNextSignedMedia } from '../_shared/order-media.ts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  // Dedicated admin credential: never authorize using unverified JWT role claims
  // or require a caller's legacy JWT to equal the platform's injected API key.
  const preparationSecret = Deno.env.get('SIGNFORTH_MEDIA_PREPARATION_SECRET') || '';
  if (!/^[a-f0-9]{64}$/.test(preparationSecret)) {
    return reply({ error: 'Media preparation secret is not configured correctly.' }, 503);
  }
  const provided = request.headers.get('x-signforth-media-secret') || '';
  if (!/^[a-f0-9]{64}$/.test(provided)) {
    return reply({ error: 'Administrator authorization required.' }, 403);
  }
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= preparationSecret.charCodeAt(i) ^ provided.charCodeAt(i);
  if (difference !== 0) return reply({ error: 'Administrator authorization required.' }, 403);
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return reply({ error: 'Server database credential is unavailable.' }, 503);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let processed = 0;
  try {
    const started = Date.now();
    while (processed < 5 && Date.now() - started < 40_000) {
      if (!await prepareNextSignedMedia(admin)) break;
      processed++;
    }
    const { data, error } = await admin.rpc('signforth_media_progress');
    if (error) throw new Error('Unable to read preparation progress');
    return reply({ processed, ...data });
  } catch (error) {
    // Messages are controlled internally; no customer content, tokens, or paths.
    return reply({ processed, error: error instanceof Error ? error.message : 'Media preparation failed.' }, 503);
  }
});
