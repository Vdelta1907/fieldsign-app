// GENERATED: run node scripts/build-private-media-dashboard.mjs after editing shared/source functions.
export class ClientRequestError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}

// Stream the body so a missing/false Content-Length cannot bypass the bound.
export async function readClientBody(request: Request, maxBytes: number) {
  if (!request.body) throw new ClientRequestError('Invalid request.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ClientRequestError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new ClientRequestError('Invalid request.', 400); }
}

type LimitClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export async function enforceClientLimit(admin: LimitClient, token: string, kind: 'read' | 'write') {
  // Token possession defines the public client's scope. Do not trust caller IP headers.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.toLowerCase()));
  const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await admin.rpc('signforth_consume_client_limit', { p_kind: kind, p_token_hash: tokenHash });
  const result = data as { allowed?: boolean; retry_after?: number } | null;
  if (error || !result || typeof result.allowed !== 'boolean') {
    throw new ClientRequestError('Service temporarily unavailable. Please try again shortly.', 503);
  }
  if (!result.allowed) {
    const seconds = Math.min(60, Math.max(1, Math.ceil(Number(result.retry_after) || 60)));
    throw new ClientRequestError(`Too many requests. Please wait ${seconds} seconds and try again.`, 429, seconds);
  }
}

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const MEDIA_BUCKET = 'signforth-order-media-v1';
export const MEDIA_FIELDS = ['contractor_logo', 'photo_data', 'photo_data_2', 'signature_data'] as const;
export async function mediaHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

type MediaReference = { field: string; sha256: string; byteLength: number; path: string };
export async function authorizeOrderMedia(admin: SupabaseClient, order: Record<string, unknown> | null) {
  if (!order) return null;
  const refs = (order._media || []) as MediaReference[];
  const urls = new Map<string, string>();
  const media = [];
  for (const ref of refs) {
    let url = urls.get(ref.path);
    if (!url) {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(ref.path, 60);
      if (error || !data?.signedUrl) throw new Error('Unable to authorize order media');
      url = data.signedUrl;
      urls.set(ref.path, url);
    }
    // No raw storage paths or owner identifiers need to be exposed separately.
    media.push({ field: ref.field, sha256: ref.sha256, byteLength: ref.byteLength, url });
  }
  return { ...order, _media: media };
}

export async function prepareNextSignedMedia(admin: SupabaseClient): Promise<boolean> {
  const { data: order, error: readError } = await admin.rpc('signforth_next_media_order');
  if (readError) throw new Error('Unable to read the next signed order');
  if (!order) return false;
  const storage = admin.storage.from(MEDIA_BUCKET);
  const verified = new Set<string>();
  for (const field of MEDIA_FIELDS) {
    const source = order[field];
    if (source === null || source === undefined || source === '') continue;
    if (typeof source !== 'string') throw new Error('Invalid stored media');
    const bytes = new TextEncoder().encode(source);
    if (bytes.length > 8_000_000) throw new Error('Stored media exceeds the preparation size limit');
    const hash = await mediaHash(bytes);
    const path = `${order.owner_id}/${hash}.txt`;
    if (!verified.has(path)) {
      const { error: uploadError } = await storage.upload(path, bytes, {
        contentType: 'text/plain', cacheControl: '0', upsert: false,
      });
      // Existing content-addressed objects are reusable ONLY after a byte/hash check.
      // Also handles workers racing to create the same object. Storage versions
      // report existing-object conflicts as 400 or 409; neither is trusted without read-back.
      if (uploadError && !['400', '409', 'Duplicate', 'ResourceAlreadyExists'].includes(String(uploadError.statusCode))
          && !('code' in uploadError && ['Duplicate', 'ResourceAlreadyExists'].includes(String(uploadError.code)))) {
        throw new Error('Private media upload failed');
      }
      const { data: stored, error: downloadError } = await storage.download(path);
      if (downloadError || !stored) throw new Error('Private media verification download failed');
      const readBack = new Uint8Array(await stored.arrayBuffer());
      if (readBack.byteLength !== bytes.byteLength || await mediaHash(readBack) !== hash) {
        throw new Error('Private media verification failed');
      }
      verified.add(path);
    }
    const { error } = await admin.rpc('signforth_register_order_media', {
      p_order_id: order.id, p_field: field, p_hash: hash, p_bytes: bytes.byteLength,
    });
    if (error) throw new Error('Unable to publish the verified media reference');
  }
  const { error } = await admin.rpc('signforth_finish_media_order', { p_order_id: order.id });
  if (error) throw new Error('Unable to finish signed media preparation');
  return true;
}

// Compatibility for a client using the earlier inline order gateway operation.
// Authorization has already been checked by signforth_get_order_media.
export async function inlineOrderMedia(admin: SupabaseClient, order: Record<string, unknown>) {
  const result = { ...order };
  for (const ref of (order._media || []) as MediaReference[]) {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(ref.path);
    if (error || !data || data.size !== ref.byteLength || data.size > 8_000_000) throw new Error('Media download failed');
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (await mediaHash(bytes) !== ref.sha256) throw new Error('Media verification failed');
    result[ref.field] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  delete result._media;
  return result;
}

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
        typeof action !== 'string' || !['order', 'order-media', 'state', 'respond'].includes(action)) {
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
    } else if (action === 'order-media') {
      operation = admin.rpc('signforth_get_order_media', { p_token: signingToken });
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
    if (action === 'order-media') {
      const resolved = await authorizeOrderMedia(admin, data);
      return jsonResponse({ data: resolved ? [resolved] : [] }, 200, origin);
    }
    if (action === 'order' && Array.isArray(data) && data.some(row =>
      ['contractor_logo','photo_data','photo_data_2','signature_data'].some(field => typeof row[field] === 'string' && row[field].startsWith('sfmedia:')))) {
      const { data: resolved, error: resolveError } = await admin.rpc('signforth_get_order_media', { p_token: signingToken });
      if (resolveError) throw new Error('Media authorization failed');
      return jsonResponse({ data: resolved ? [await inlineOrderMedia(admin, resolved)] : [] }, 200, origin);
    }
    return jsonResponse({ data }, 200, origin);
  } catch (error) {
    if (error instanceof ClientRequestError) return jsonResponse({ error: error.message }, error.status, origin, error.retryAfter);
    return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503, origin);
  }
});
