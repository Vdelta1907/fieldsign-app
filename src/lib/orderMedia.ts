import type { SupabaseClient } from '@supabase/supabase-js';

const fields = new Set(['contractor_logo', 'photo_data', 'photo_data_2', 'signature_data']);
const maxBytes = 8_000_000;
// Only short-lived in-memory reuse, scoped to the existing workspace client.
// No localStorage, IndexedDB, Cache API, service worker or persistent file cache.
const caches = new WeakMap<SupabaseClient, Map<string, { value: string; expires: number; size: number }>>();
export class MediaDownloadError extends Error {
  refreshable: boolean;
  constructor(refreshable = false) {
    super('An order image could not be verified or downloaded. Please try again.');
    this.refreshable = refreshable;
  }
}

type Reference = { field: string; sha256: string; byteLength: number; url: string };
async function readVerifiedMedia(ref: Reference, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetch(ref.url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new MediaDownloadError([400, 401, 403].includes(response.status));
    if (!response.body) throw new MediaDownloadError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > ref.byteLength) { await reader.cancel(); throw new MediaDownloadError(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (count !== ref.byteLength) throw new MediaDownloadError();
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== ref.sha256) throw new MediaDownloadError();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function hydrateOrderMedia<T extends Record<string, unknown>>(
  client: SupabaseClient, order: T, scope: string, signal?: AbortSignal,
): Promise<T> {
  const refs = order._media;
  if (refs === undefined) return order;
  if (!Array.isArray(refs) || refs.length > 4) throw new MediaDownloadError();
  let cache = caches.get(client);
  if (!cache) { cache = new Map(); caches.set(client, cache); }
  for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
  const result: Record<string, unknown> = { ...order };
  const seen = new Set<string>();
  for (const ref of refs as Reference[]) {
    if (!ref || !fields.has(ref.field) || seen.has(ref.field) || !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        !Number.isInteger(ref.byteLength) || ref.byteLength < 1 || ref.byteLength > maxBytes || typeof ref.url !== 'string') {
      throw new MediaDownloadError();
    }
    seen.add(ref.field);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const key = `${scope}:${ref.sha256}`;
    let entry = cache.get(key);
    if (entry && entry.size !== ref.byteLength) throw new MediaDownloadError();
    if (!entry) {
      const value = await readVerifiedMedia(ref, signal);
      let used = Array.from(cache.values()).reduce((sum, item) => sum + item.size, 0);
      while (used + ref.byteLength > maxBytes && cache.size) {
        const oldest = cache.keys().next().value!;
        used -= cache.get(oldest)!.size;
        cache.delete(oldest);
      }
      entry = { value, size: ref.byteLength, expires: Date.now() + 120_000 };
      cache.set(key, entry);
    }
    result[ref.field] = entry.value;
  }
  delete result._media;
  return result as T;
}

export async function loadContractorOrderMedia(client: SupabaseClient, orderId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await client.functions.invoke('contractor-order-media', { body: { orderId } });
    if (error) {
      if ('context' in error && error.context instanceof Response) {
        const body = await error.context.clone().json().catch(() => null);
        if (typeof body?.error === 'string') throw new Error(body.error);
      }
      throw error;
    }
    if (!data?.data) throw new Error('The signed order is unavailable.');
    try { return await hydrateOrderMedia(client, data.data, 'owner'); }
    catch (error) {
      if (attempt === 0 && error instanceof MediaDownloadError && error.refreshable) continue;
      throw error;
    }
  }
  throw new MediaDownloadError();
}
