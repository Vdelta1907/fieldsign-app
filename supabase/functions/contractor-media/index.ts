import { storeVerifiedUpload, uploadsEnabled } from '../_shared/future-media.ts';
import { authorizeOrderMedia } from '../_shared/order-media.ts';
import { ClientRequestError, enforceClientLimit, readClientBody } from '../_shared/client-limits.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const appUrl = Deno.env
  .get('APP_URL')!
  .replace(/\/+$/, '');

const vercelPreviewPattern =
  /^https:\/\/(?:fieldsign|signforth)[a-z0-9-]*-vac-cardiovascular-imaging\.vercel\.app$/i;

const allowedLocalOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const isAllowedOrigin = (
  origin: string | null,
): boolean => {
  if (!origin) return true;

  return (
    origin === appUrl ||
    allowedLocalOrigins.has(origin) ||
    vercelPreviewPattern.test(origin)
  );
};

const getCorsHeaders = (
  origin: string | null,
): Record<string, string> => ({
  'Access-Control-Allow-Origin':
    origin && isAllowedOrigin(origin)
      ? origin
      : appUrl,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
  'Access-Control-Expose-Headers': 'Retry-After',
});

const jsonResponse = (
  body: unknown,
  status: number,
  origin: string | null,
  retryAfter = 0,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  try {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in to view this order.' }, 401, origin);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !identity.user) return jsonResponse({ error: 'Sign in to view this order.' }, 401, origin);
    const body = await readClientBody(request, 1_510_000);
    if (body.action === 'upload') {
      await enforceClientLimit(admin, identity.user.id, 'write');
      if (typeof body.source !== 'string') throw new ClientRequestError('Invalid image request.', 400);
      // Disabled mode preserves the previous save behavior during reader deployment/rollback.
      if (!await uploadsEnabled(admin)) return jsonResponse({ reference: body.source }, 200, origin);
      const reference = await storeVerifiedUpload(admin, identity.user.id, body.source);
      return jsonResponse({ reference }, 200, origin);
    }
    if (body.action !== 'resolve' || !Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 4 ||
        body.sources.some(value => typeof value !== 'string' || !/^sfmedia:v1:[a-f0-9]{64}$/.test(value))) {
      throw new ClientRequestError('Invalid image request.', 400);
    }
    await enforceClientLimit(admin, identity.user.id, 'read');
    const { data, error } = await admin.rpc('signforth_resolve_uploads', { p_owner: identity.user.id, p_sources: body.sources });
    if (error || !Array.isArray(data)) return jsonResponse({ error: 'These images are unavailable.' }, 404, origin);
    const resolved = [];
    for (const row of data) {
      const result = await authorizeOrderMedia(admin, { _media: [row] });
      resolved.push({ reference: row.reference, media: result?._media });
    }
    return jsonResponse({ data: resolved }, 200, origin);
  } catch (error) {
    if (error instanceof ClientRequestError) return jsonResponse({ error: error.message }, error.status, origin, error.retryAfter);
    return jsonResponse({ error: 'Unable to load this order. Please try again.' }, 503, origin);
  }
});
