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
