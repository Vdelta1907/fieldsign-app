// GENERATED: node scripts/build-future-media-dashboard.mjs
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// _shared/client-limits.ts
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

// _shared/order-media.ts

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

// _shared/future-media.ts

export function validateImageSource(source: unknown, signature = false): { bytes: Uint8Array; mime: string } {
  if (typeof source !== 'string' || source.length > (signature ? 750_000 : 1_500_000)) {
    throw new ClientRequestError('The image is too large or invalid.', 400);
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || (signature && match[1] !== 'image/png')) throw new ClientRequestError('Use a PNG or JPEG image.', 400);
  let raw: string;
  try { raw = atob(match[2]); } catch { throw new ClientRequestError('The image is invalid.', 400); }
  if (btoa(raw) !== match[2]) throw new ClientRequestError('The image encoding is invalid.', 400);
  const isPng = raw.startsWith('\x89PNG\r\n\x1a\n') && raw.length >= 33 && raw.slice(12, 16) === 'IHDR';
  const isJpeg = raw.startsWith('\xff\xd8\xff') && raw.endsWith('\xff\xd9');
  if (match[1] === 'image/png' ? !isPng : !isJpeg) throw new ClientRequestError('The image format is invalid.', 400);
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let width = 0; let height = 0;
  if (isPng) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else {
    // Find a JPEG frame header before compressed scan data; all reads stay bounded.
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) break;
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new ClientRequestError('The image dimensions are invalid or too large.', 400);
  }
  return { bytes: new TextEncoder().encode(source), mime: match[1] };
}

export async function uploadsEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.rpc('signforth_uploads_enabled');
  if (error || typeof data !== 'boolean') throw new Error('Unable to read upload configuration');
  return data;
}

export async function storeVerifiedUpload(admin: SupabaseClient, owner: string, source: string, signature = false): Promise<string> {
  const { bytes, mime } = validateImageSource(source, signature);
  const hash = await mediaHash(bytes);
  const reference = `sfmedia:v1:${hash}`;
  // Only this service-verified registry can authorize reuse. Caller-supplied hashes are never trusted.
  const { data: existing, error: existingError } = await admin.rpc('signforth_resolve_uploads', { p_owner: owner, p_sources: [reference] });
  if (!existingError && Array.isArray(existing) && existing.length === 1 && existing[0].byteLength === bytes.length) return reference;
  const storage = admin.storage.from(MEDIA_BUCKET);
  const path = `${owner}/${hash}.txt`;
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: 'text/plain', cacheControl: '0', upsert: false });
  if (uploadError && !['400','409','Duplicate','ResourceAlreadyExists'].includes(String(uploadError.statusCode)) &&
      !('code' in uploadError && ['Duplicate','ResourceAlreadyExists'].includes(String(uploadError.code)))) throw new Error('Media upload failed');
  const { data: stored, error: downloadError } = await storage.download(path);
  if (downloadError || !stored) throw new Error('Media verification failed');
  const check = new Uint8Array(await stored.arrayBuffer());
  if (check.length !== bytes.length || await mediaHash(check) !== hash) throw new Error('Media verification failed');
  const { data, error } = await admin.rpc('signforth_register_upload', { p_owner: owner, p_hash: hash, p_bytes: bytes.length, p_mime: mime });
  if (error || data !== reference) throw new Error('Media registration failed');
  return reference;
}

// submit-signature/index.ts
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

const getSigningIp = (
  request: Request,
): string | null => {
  const value = request.headers
    .get('cf-connecting-ip')
    ?.trim();

  // Require a single address, not a forwarded-address list.
  // PostgreSQL's inet type validates the address before saving.
  if (!value || /[\s,[\]]/.test(value)) {
    return null;
  }

  return value;
};

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(
      { error: 'Request origin is not allowed.' },
      403,
      origin,
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: getCorsHeaders(origin),
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed.' },
      405,
      origin,
    );
  }

  try {
    const body = await readClientBody(request, 800_000);

    const signingToken = body?.signingToken;
    const signerName = body?.signerName;
    const signatureData = body?.signatureData;
    const consentText = body?.consentText;
    const paymentRequested =
      body?.paymentRequested ?? false;
    const submissionId = body?.submissionId;

    if (
      typeof signingToken !== 'string' ||
      !uuidPattern.test(signingToken) ||
      typeof submissionId !== 'string' ||
      !uuidPattern.test(submissionId)
    ) {
      return jsonResponse(
        { error: 'Invalid signing request.' },
        400,
        origin,
      );
    }

    if (
      typeof signerName !== 'string' ||
      typeof signatureData !== 'string' ||
      typeof consentText !== 'string' ||
      typeof paymentRequested !== 'boolean'
    ) {
      return jsonResponse(
        { error: 'Invalid signing information.' },
        400,
        origin,
      );
    }

    const signingIp = getSigningIp(request);

    if (!signingIp) {
      return jsonResponse(
        {
          error:
            'Unable to verify signing network information. Please try again.',
        },
        503,
        origin,
      );
    }

    const userAgent =
      request.headers
        .get('user-agent')
        ?.trim() || '';

    if (!userAgent) {
      return jsonResponse(
        {
          error:
            'Unable to verify signing browser information. Please try again.',
        },
        400,
        origin,
      );
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY',
      )!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    await enforceClientLimit(admin, signingToken, 'write');

    let storedSignature = signatureData;
    if (await uploadsEnabled(admin)) {
      const { data: context, error: contextError } = await admin.rpc('signforth_signature_upload_context', {
        p_token: signingToken, p_submission: submissionId,
      });
      if (contextError) throw new Error('Unable to authorize signature upload');
      if (!context?.owner_id) return jsonResponse({ error: 'This signing link is invalid, expired, or already used.' }, 400, origin);
      storedSignature = typeof context.existing_signature === 'string'
        ? context.existing_signature
        : await storeVerifiedUpload(admin, context.owner_id, signatureData, true);
    }

    const { data, error } = await admin.rpc(
      'fieldsign_sign_order_with_evidence',
      {
        p_token: signingToken,
        p_signer_name: signerName,
        p_signature_data: storedSignature,
        p_consent_text: consentText,
        p_payment_requested:
          paymentRequested,
        p_submission_id: submissionId,
        p_signing_ip: signingIp,
        p_user_agent: userAgent,
      },
    );

    if (error) {
      console.error(
        'Evidence signing failed:',
        {
          code: error.code,
        },
      );

      const message =
        error.message ||
        'Unable to save the authorization.';

      const normalizedMessage =
        message.toLowerCase();

      const status =
        normalizedMessage.includes(
          'invalid or no longer active',
        ) ||
        normalizedMessage.includes(
          'invalid, expired, or already used',
        ) ||
        normalizedMessage.includes(
          'stripe payment is not enabled',
        )
          ? 409
          : 400;

      return jsonResponse(
        { error: message },
        status,
        origin,
      );
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (!result) {
      throw new Error(
        'The signing operation returned no result.',
      );
    }

    return jsonResponse(
      {
        signedAtUtc:
          result.signed_at_utc,
        paymentStatus:
          result.payment_status,
        alreadyRecorded:
          result.already_recorded,
        documentHash:
          result.document_hash,
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof ClientRequestError) {
      return jsonResponse({ error: error.message }, error.status, origin, error.retryAfter);
    }
    console.error(
      'Signature Edge Function error:',
      'Request failed',
    );

    return jsonResponse(
      {
        error:
          'Unable to save the authorization securely. Please try again.',
      },
      500,
      origin,
    );
  }
});
