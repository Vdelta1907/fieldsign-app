import type { SupabaseClient } from '@supabase/supabase-js';
import { hydrateOrderMedia } from './orderMedia';
import { ExportZip, type ExportSink } from './exportZip';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
const sections = ['profile', 'orders', 'revisions', 'activity', 'evidence', 'deletion_request'] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const refPattern = /^sfmedia:v1:([a-f0-9]{64})$/;
async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function exportAccount({ client, accountId, isCurrent, signal, sink, progress }: {
  client: SupabaseClient; accountId: string; isCurrent: () => boolean;
  signal: AbortSignal; sink: ExportSink; progress: (message: string) => void;
}) {
  const started = new Date().toISOString();
  const counts: Record<string, number> = {};
  const media = new Map<string, { bytes: number; file: string }>();
  const expected = new Map<string, number>();
  const check = () => {
    if (signal.aborted || !isCurrent()) throw new DOMException('Export cancelled or account changed.', 'AbortError');
  };
  const zip = new ExportZip({
    async write(bytes) { check(); await sink.write(bytes); check(); },
    async close() { check(); await sink.close(); },
    abort: () => sink.abort(),
  });
  const expectMedia = (key: unknown, size: unknown) => {
    if (typeof key !== 'string' || !hashPattern.test(key) || !Number.isInteger(size) || Number(size) < 1) throw new Error('An evidence image reference is invalid. Export stopped.');
    if (expected.has(key) && expected.get(key) !== size) throw new Error('Conflicting image evidence. Export stopped.');
    expected.set(key, Number(size));
  };
  const storeImage = async (source: string, expectedHash?: string) => {
    check();
    const bytes = new TextEncoder().encode(source);
    if (bytes.length > 8_000_000) throw new Error('An image exceeds the supported export size. Export stopped.');
    const key = await hash(bytes);
    if (expectedHash && key !== expectedHash) throw new Error('Image verification failed. Export stopped.');
    if (media.has(key)) return;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (!match) throw new Error('An image has an unsupported or damaged format. Export stopped.');
    const decoded = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    const file = `media/${key}.${match[1] === 'jpeg' ? 'jpg' : 'png'}`;
    await zip.add(file, decoded);
    // Keep the original data-URL bytes too, so evidence hashes remain reproducible.
    await zip.add(`media/${key}.txt`, bytes);
    media.set(key, { bytes: bytes.length, file });
  };
  const resolve = async (reference: string) => {
    const key = refPattern.exec(reference)?.[1];
    if (!key) throw new Error('Invalid private image reference. Export stopped.');
    if (media.has(key)) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      check();
      const timeout = AbortSignal.timeout(30_000);
      const { data, error } = await client.functions.invoke('contractor-media', {
        body: { action: 'resolve', sources: [reference] }, signal: AbortSignal.any([signal, timeout]),
      });
      check();
      if (error) {
        if (error.context instanceof Response && error.context.status === 429 && attempt < 3) {
          const seconds = Math.max(1, Math.min(120, Number(error.context.headers.get('Retry-After')) || 60));
          progress('Waiting briefly for image downloads…'); await delay(seconds * 1000, signal); continue;
        }
        throw new Error('An image could not be downloaded. No complete export was created. Please retry.');
      }
      const row = data?.data?.[0];
      if (data?.data?.length !== 1 || row?.reference !== reference || row.media?.length !== 1 || row.media[0].sha256 !== key) throw new Error('Image verification failed. Export stopped.');
      const hydrated = await hydrateOrderMedia(client, { contractor_logo: '', _media: row.media }, 'owner', signal);
      check(); await storeImage(hydrated.contractor_logo, key); return;
    }
  };
  const scan = async (value: unknown): Promise<void> => {
    check();
    if (typeof value === 'string') {
      if (value.startsWith('sfmedia:')) await resolve(value);
      else if (value.startsWith('data:image/')) await storeImage(value);
    } else if (Array.isArray(value)) {
      for (const item of value) await scan(item);
    } else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if ('sha256' in object && 'byte_length' in object) expectMedia(object.sha256, object.byte_length);
      if ('signature_sha256' in object) expectMedia(object.signature_sha256, object.signature_byte_length);
      for (const [key, item] of Object.entries(object)) {
        if (['contractor_logo', 'photo_data', 'photo_data_2', 'signature_data', 'logo_data_url'].includes(key) &&
            item !== null && item !== undefined && item !== '' &&
            (typeof item !== 'string' || (!item.startsWith('sfmedia:') && !item.startsWith('data:image/')))) {
          throw new Error('An image uses an unsupported reference. Export stopped; contact support.');
        }
        // Canonical evidence is a text duplicate of evidence_snapshot, not another media source.
        if (key !== 'evidence_snapshot_canonical') await scan(item);
      }
    }
  };
  try {
    for (const section of sections) {
      let after: string | null = null; counts[section] = 0;
      while (true) {
        check(); progress(`Exporting ${section.replace('_', ' ')}: ${counts[section]} records…`);
        const { data, error } = await client.rpc('signforth_export_account_page', { p_section: section, p_after: after })
          .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
        check();
        if (error) throw new Error('Account records could not be exported. No complete export was created. Please retry.');
        if (data?.version !== 1 || data.account_id !== accountId || data.section !== section) throw new Error('Account verification failed. Export stopped.');
        if (data.record === null && data.next === null) break;
        if (!data.record || typeof data.next !== 'string' || !uuid.test(data.next) || (after && data.next <= after)) throw new Error('Invalid export page. Export stopped.');
        if (section === 'evidence') {
          const evidence = data.record;
          if (evidence.hash_algorithm !== 'SHA-256' || typeof evidence.evidence_snapshot_canonical !== 'string' ||
              await hash(new TextEncoder().encode(evidence.evidence_snapshot_canonical)) !== evidence.document_hash) {
            throw new Error('Signing evidence could not be verified. Export stopped; contact support.');
          }
        }
        await scan(data.record); check();
        await zip.add(`${section}/${data.next}.json`, encode(data.record));
        counts[section]++; after = data.next;
      }
    }
    for (const [key, bytes] of expected) {
      if (media.get(key)?.bytes !== bytes) throw new Error('An image referenced by signing evidence is missing or differs. Export stopped; contact support.');
    }
    check();
    await zip.add('README.txt', new TextEncoder().encode(`SignForth account export v1\n\nRecords are JSON files, grouped by section. Orders include retained archived orders.\nMedia contains viewable PNG/JPEG files and original data-URL .txt files.\nsfmedia:v1:<hash> resolves to media/<hash>.txt; image hashes cover the .txt bytes.\nSigning evidence includes original PostgreSQL canonical snapshot text for document-hash verification.\nPayment state is included; Stripe credentials, checkout links, signing tokens, authentication secrets, raw payment-provider events and internal operational registries are excluded.\n\nThis is a live, paginated account export, NOT a point-in-time database backup.\nRecords were read between the times in manifest.json. Concurrent edits, new orders or deletions may affect coverage and consistency. Avoid changes during export.\nIndividual signed PDFs remain available through the existing order download action.\nKeep this archive private: it contains client details and signatures.\n`));
    await zip.add('manifest.json', encode({ format: 'signforth.account-export.v1', account_id: accountId,
      started_at: started, finished_at: new Date().toISOString(), consistency: 'live-paginated-not-atomic',
      archived_orders_included: true, counts, media: Object.fromEntries(media) }));
    check(); await zip.finish();
    return counts;
  } catch (error) {
    await sink.abort().catch(() => {}); throw error;
  }
}
