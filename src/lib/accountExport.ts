import type { SupabaseClient } from '@supabase/supabase-js';
import { hydrateOrderMedia } from './orderMedia';
import { ExportZip, type ExportSink } from './exportZip';
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
  const media = new Map<string, { bytes: number }>();
  const orderTitles = new Map<string, string>();
  const expected = new Map<string, number>();
  const pageImages = new Map<string, string>();
  let signedAgreements = 0;
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
    pageImages.set(key, source);
    if (media.has(key)) return;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (!match) throw new Error('An image has an unsupported or damaged format. Export stopped.');
    atob(match[2]);
    media.set(key, { bytes: bytes.length });
  };
  const resolve = async (reference: string, needSource = false) => {
    const key = refPattern.exec(reference)?.[1];
    if (!key) throw new Error('Invalid private image reference. Export stopped.');
    if (media.has(key) && (!needSource || pageImages.has(key))) return;
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
  const imagesFor = async (record: Record<string, unknown>) => {
    const images: Record<string, string> = {};
    for (const field of ['contractor_logo', 'photo_data', 'photo_data_2', 'signature_data', 'logo_data_url']) {
      const source = record[field];
      if (!source) { images[field] = ''; continue; }
      if (typeof source !== 'string') throw new Error('Invalid saved image. Export stopped.');
      if (refPattern.test(source)) { await resolve(source, true); images[field] = pageImages.get(source.slice(11)) || ''; }
      else images[field] = source;
    }
    return images;
  };
  const filename = (section: string, title: string) => {
    const slug = title.normalize('NFKD').replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/ +/g, '-').slice(0, 90) || 'Record';
    return `${String(counts[section] + 1).padStart(3, '0')}-${slug}.pdf`;
  };
  try {
    for (const section of sections) {
      let after: string | null = null; counts[section] = 0;
      while (true) {
        check(); progress(`Exporting ${{ profile: 'business profile', orders: 'orders', revisions: 'order revisions', activity: 'order activity', evidence: 'signing records', deletion_request: 'account requests' }[section]}: ${counts[section]} records…`);
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
        pageImages.clear();
        await scan(data.record); check();
        const { signedAgreementPdf, accountReportPdf } = await import('./accountExportPdf');
        const record = data.record;
        const title = String(record.project_title || record.company_name || orderTitles.get(record.order_id) || 'Account record');
        if (section === 'orders') orderTitles.set(data.next, title);
        if (section === 'orders' && record.status === 'signed') {
          progress('Preparing signed agreement PDF…');
          const { data: proofs, error: proofError } = await client.from('order_authorization_evidence')
            .select('order_id,owner_id,revision_number,evidence_snapshot,document_hash,hash_algorithm,signer_name,signed_at_utc')
            .eq('order_id', data.next).eq('owner_id', accountId).eq('revision_number', data.record.revision_number)
            .limit(2).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
          check();
          if (proofError || !Array.isArray(proofs) || proofs.length > 1) throw new Error('Signing records could not be read. Export stopped.');
          const proof = proofs[0] || null;
          if (proof && (proof.order_id !== data.next || proof.owner_id !== accountId || proof.revision_number !== data.record.revision_number)) throw new Error('Signing record does not match the order. Export stopped.');
          const images = await imagesFor(record);
          // Bind each displayed image to the saved signing evidence when present.
          if (proof) {
            const e = proof.evidence_snapshot;
            const refs = [e?.contractor?.displayed_logo, e?.photos?.[0], e?.photos?.[1],
              e?.signature ? { sha256: e.signature.signature_sha256, byte_length: e.signature.signature_byte_length } : null];
            for (const [i, field] of ['contractor_logo', 'photo_data', 'photo_data_2', 'signature_data'].entries()) {
              const bytes = new TextEncoder().encode(images[field]);
              const ref = refs[i];
              if (ref ? bytes.length !== ref.byte_length || await hash(bytes) !== ref.sha256 : !!images[field]) throw new Error('Signed agreement images do not match the signing record. Export stopped.');
            }
          }
          const pdf = await signedAgreementPdf(data.record, proof, images);
          check(); await zip.add(`Signed-agreements/${filename(section, title)}`, pdf); signedAgreements++;
        } else if (section === 'orders' || section === 'revisions') {
          const content = section === 'orders' ? record : record.snapshot;
          if (!content || typeof content !== 'object') throw new Error('The saved order record is unavailable. Export stopped.');
          const images = await imagesFor(content);
          const pdf = await signedAgreementPdf(content, null, images, false);
          check(); await zip.add(`${section === 'orders' ? 'Other-orders' : 'Order-revisions'}/${filename(section, title)}`, pdf);
        } else {
          const labels: Record<string, string> = { profile: 'Business profile', activity: 'Order activity', evidence: 'Signing record', deletion_request: 'Account request' };
          const images = section === 'profile' ? await imagesFor(record) : {};
          const pdf = await accountReportPdf(labels[section], { ...(record.order_id ? { project: orderTitles.get(record.order_id) || 'Order record', order_reference: String(record.order_id).slice(0, 8) } : {}), ...record }, images.logo_data_url || '');
          check(); await zip.add(`Account-records/${section}-${filename(section, title)}`, pdf);
        }
        counts[section]++; after = data.next;
      }
    }
    for (const [key, bytes] of expected) {
      if (media.get(key)?.bytes !== bytes) throw new Error('An image referenced by signing evidence is missing or differs. Export stopped; contact support.');
    }
    check();
    counts.signed_agreements = signedAgreements;
    const { accountReportPdf } = await import('./accountExportPdf');
    await zip.add('START-HERE.pdf', await accountReportPdf('Your account export', {
      welcome: 'Your records are ready to open, print or share. Every file in this download is a PDF.',
      signed_agreements: `${signedAgreements} complete signed agreements, with saved signatures, terms and photos. Open the Signed-agreements folder. Retained archived agreements are included.`,
      other_orders: `${counts.orders - signedAgreements} other order records. These are not signed agreements. Open Other-orders if present.`,
      order_revisions: `${counts.revisions} saved revisions. Open Order-revisions if present.`,
      account_records: 'Business profile, activity, signing records and any account deletion request are in Account-records.',
      export_started: started, export_finished: new Date().toISOString(),
      note: 'These documents are generated copies of your saved records, not new signatures. Records were collected during export; changes made at the same time may not be included. Keep this download private: it contains client details and signatures.',
    }));
    check(); await zip.finish();
    return counts;
  } catch (error) {
    await sink.abort().catch(() => {}); throw error;
  }
}
