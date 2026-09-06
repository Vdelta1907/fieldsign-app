const configuredAppUrl = Deno.env.get('APP_URL');

if (!configuredAppUrl) {
  throw new Error('APP_URL is not configured.');
}

const allowedOrigin =
  new URL(configuredAppUrl).origin;

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
  'Vary': 'Origin',
};

export const jsonResponse = (
  body: unknown,
  status = 200,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
