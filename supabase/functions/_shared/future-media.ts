import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { MEDIA_BUCKET, mediaHash } from './order-media.ts';
import { ClientRequestError } from './client-limits.ts';

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
