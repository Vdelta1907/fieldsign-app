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

    const { data, error } = await admin.rpc(
      'fieldsign_sign_order_with_evidence',
      {
        p_token: signingToken,
        p_signer_name: signerName,
        p_signature_data: signatureData,
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
