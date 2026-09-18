import type { SupabaseClient } from '@supabase/supabase-js';

export class ClientRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super(`Too many requests. Please wait ${retryAfter} seconds and try again.`);
    this.retryAfter = retryAfter;
  }
}

// Suppress polling during a server-directed cooldown. Each workspace owns its state.
const cooldowns = new WeakMap<SupabaseClient, Map<string, number>>();
export async function clientAuthorization(
  client: SupabaseClient,
  action: 'order' | 'state' | 'respond',
  signingToken: string,
  options: { signal?: AbortSignal; response?: string; note?: string | null; submissionId?: string } = {},
) {
  let limits = cooldowns.get(client);
  if (!limits) { limits = new Map(); cooldowns.set(client, limits); }
  const key = `${action === 'respond' ? 'write' : 'read'}:${signingToken.toLowerCase()}`;
  const remaining = Math.ceil(((limits.get(key) || 0) - Date.now()) / 1000);
  if (remaining > 0) return { data: null, error: new ClientRateLimitError(remaining) };
  limits.delete(key);
  const { signal, ...fields } = options;
  const { data, error } = await client.functions.invoke('client-authorization', {
    body: { action, signingToken, ...fields }, signal,
  });
  if (!error) return { data: data?.data, error: null };
  if ('context' in error && error.context instanceof Response) {
    const body = await error.context.clone().json().catch(() => null);
    if (error.context.status === 429) {
      const seconds = Math.min(60, Math.max(1, Number(error.context.headers.get('Retry-After')) || 60));
      limits.set(key, Date.now() + seconds * 1000);
      return { data: null, error: new ClientRateLimitError(seconds) };
    }
    if (typeof body?.error === 'string') return { data: null, error: new Error(body.error) };
  }
  return { data: null, error };
}
