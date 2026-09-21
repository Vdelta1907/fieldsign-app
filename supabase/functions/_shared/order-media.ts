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
