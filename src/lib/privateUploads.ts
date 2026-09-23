import type { SupabaseClient } from '@supabase/supabase-js';
import { hydrateOrderMedia } from './orderMedia';
const referencePattern = /^sfmedia:v1:[a-f0-9]{64}$/;
const uploaded = new WeakMap<SupabaseClient, Map<string, string>>();

async function invoke(client: SupabaseClient, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const { data, error } = await client.functions.invoke('contractor-media', { body, signal: controller.signal });
    if (error) {
      if ('context' in error && error.context instanceof Response && error.context.status === 429) {
        const seconds = Math.max(1, Math.min(60, Number(error.context.headers.get('Retry-After')) || 60));
        throw new Error(`Please wait ${seconds} seconds before trying again. Your changes remain in the form.`);
      }
      throw new Error('An image could not be saved or loaded. Your changes remain in the form. Please try again.');
    }
    return data;
  } finally { clearTimeout(timer); }
}

export async function uploadPrivateImage(client: SupabaseClient, source: string | null): Promise<string | null> {
  if (!source) return null;
  if (referencePattern.test(source)) return source;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  let cache = uploaded.get(client);
  if (!cache) { cache = new Map(); uploaded.set(client, cache); }
  const cached = cache.get(hash);
  if (cached) return cached;
  const data = await invoke(client, { action: 'upload', source });
  if (data?.reference !== source && data?.reference !== `sfmedia:v1:${hash}`) throw new Error('Image verification failed. Please try again.');
  // Do not cache disabled-mode responses: the later cutover must take effect without stale settings.
  if (referencePattern.test(data.reference)) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(hash, data.reference);
  }
  return data.reference;
}

export async function resolvePrivateImages(client: SupabaseClient, sources: (string | null | undefined)[]): Promise<string[]> {
  const refs = [...new Set(sources.filter((value): value is string => !!value && value.startsWith('sfmedia:')))];
  if (!refs.length) return sources.map(value => value || '');
  if (refs.length > 4 || refs.some(ref => !referencePattern.test(ref))) throw new Error('Invalid image reference.');
  const data = await invoke(client, { action: 'resolve', sources: refs });
  if (!Array.isArray(data?.data) || data.data.length !== refs.length) throw new Error('Order images are unavailable.');
  const values = new Map<string, string>();
  for (const ref of refs) {
    const item = data.data.find((row: { reference: string }) => row.reference === ref);
    if (!item || !Array.isArray(item.media) || item.media.length !== 1 || item.media[0].sha256 !== ref.slice(11)) throw new Error('Image verification failed.');
    const result = await hydrateOrderMedia(client, { contractor_logo: '', _media: item.media }, 'owner');
    values.set(ref, result.contractor_logo);
  }
  return sources.map(source => source && values.has(source) ? values.get(source)! : source || '');
}
