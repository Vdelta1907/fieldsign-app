import { authorizeOrderMedia } from '../_shared/order-media.ts';
import { ClientRequestError, enforceClientLimit, readClientBody } from '../_shared/client-limits.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const appUrl = Deno.env
  .get('APP_URL')!
  .replace(/\/+$/, '');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const body = await readClientBody(request, 4096);
    if (typeof body.orderId !== 'string' || !uuidPattern.test(body.orderId)) {
      throw new ClientRequestError('Invalid order request.', 400);
    }
    // Use verified user identity as the budget key, never a supplied owner ID.
    await enforceClientLimit(admin, identity.user.id, 'read');
    const { data, error } = await admin.rpc('signforth_get_order_media', {
      p_order_id: body.orderId, p_owner_id: identity.user.id,
    });
    if (error) throw new Error('Order read failed');
    if (!data) return jsonResponse({ error: 'The signed order is unavailable.' }, 404, origin);
    return jsonResponse({ data: await authorizeOrderMedia(admin, data) }, 200, origin);
  } catch (error) {
    if (error instanceof ClientRequestError) return jsonResponse({ error: error.message }, error.status, origin, error.retryAfter);
    return jsonResponse({ error: 'Unable to load this order. Please try again.' }, 503, origin);
  }
});
