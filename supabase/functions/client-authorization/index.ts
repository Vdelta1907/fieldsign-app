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
    const body = await readClientBody(request, 16_384);
    const { action, signingToken } = body;
    if (typeof signingToken !== 'string' || !uuidPattern.test(signingToken) ||
        typeof action !== 'string' || !['order', 'state', 'respond'].includes(action)) {
      throw new ClientRequestError('Invalid authorization request.', 400);
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await enforceClientLimit(admin, signingToken, action === 'respond' ? 'write' : 'read');
    let operation;
    if (action === 'respond') {
      if (typeof body.submissionId !== 'string' || !uuidPattern.test(body.submissionId) ||
          typeof body.response !== 'string' || !['changes_requested', 'declined'].includes(body.response) ||
          (body.note !== null && body.note !== undefined && typeof body.note !== 'string')) {
        throw new ClientRequestError('Invalid client response.', 400);
      }
      operation = admin.rpc('fieldsign_submit_client_response_v2', {
        p_signing_token: signingToken, p_response: body.response,
        p_note: body.note ?? null, p_submission_id: body.submissionId,
      });
    } else if (action === 'order') {
      operation = admin.rpc('get_order_for_signing', { p_token: signingToken });
    } else {
      operation = admin.rpc('fieldsign_get_link_state', { p_signing_token: signingToken });
    }
    const { data, error } = await operation;
    if (error) {
      // Preserve business validation messages, without exposing arbitrary SQL errors.
      const message = error.code === 'P0001' ? error.message : 'Unable to process this authorization. Please try again.';
      return jsonResponse({ error: message }, error.code === 'P0001' ? 400 : 503, origin);
    }
    return jsonResponse({ data }, 200, origin);
  } catch (error) {
    if (error instanceof ClientRequestError) return jsonResponse({ error: error.message }, error.status, origin, error.retryAfter);
    return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503, origin);
  }
});
