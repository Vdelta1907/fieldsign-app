import { jsPDF } from 'jspdf';
type Data = Record<string, unknown>;
const obj = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const str = (v: unknown) => v == null ? '' : String(v);
const pdfText = (v: unknown) => {
  // Copyright/registered/trademark emoji presentation selectors affect appearance,
  // not wording. Print their standard text glyphs with this PDF's text font.
  // Do not strip selectors globally: other Unicode sequences can be meaningful.
  // Only the rendering copy changes; saved records/evidence remain untouched.
  const text = str(v).replace(/([©®™])[\uFE0E\uFE0F]/gu, '$1');
  if (/[^\t\n\r\x20-\xff\u2013-\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039-\u203a\u20ac\u2122]/u.test(text)) {
    throw new Error('A record contains characters this PDF export cannot yet render accurately. Export stopped; contact support.');
  }
  return text;
};
// Historical default-v1 used by the existing agreement/PDF workflow.
const defaultTerms = 'The undersigned authorizes the contractor to perform the modifications or services described above. Labor, equipment, and materials will be provided in accordance with the stated scope and payment terms. By checking the consent box and signing, the signer confirms their intent to authorize this electronic record and agrees to receive and retain it electronically.';
export async function signedAgreementPdf(order: Data, evidence: Data | null, images: Record<string, string>, requireSigned = true) {
  if (requireSigned && (order.status !== 'signed' || !images.signature_data)) throw new Error('A signed agreement is missing its saved signature. Export stopped.');
  const snapshot = obj(evidence?.evidence_snapshot);
  const contractor = obj(snapshot.contractor), client = obj(snapshot.client), authorization = obj(snapshot.authorization), signature = obj(snapshot.signature);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const width = 532, left = 40, bottom = 738;
  let y = 100;
  const company = str(contractor.company ?? order.contractor_company);
  const title = str(obj(snapshot.order).project_title ?? order.project_title);
  const stamp = str(signature.signed_at_utc ?? evidence?.signed_at_utc ?? order.signed_at_utc ?? order.signed_at);
  const time = new Date(stamp);
  const date = Number.isNaN(time.valueOf()) ? stamp : time.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
  const header = () => {
    doc.setFillColor(245, 158, 11); doc.rect(0, 0, 612, 8, 'F');
    doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.text(requireSigned ? 'SIGNED WORK AGREEMENT' : 'ORDER RECORD', left, 38);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 100, 120);
    doc.text(`Order ${str(order.id).slice(0, 8)} | Revision ${str(order.revision_number || 1)}`, left, 56);
    doc.text(requireSigned ? 'Exported copy of the saved electronic authorization' : `Saved order copy | Status: ${str(order.status || 'Not recorded').replace(/_/g, ' ')}`, left, 70);
    doc.setDrawColor(220, 226, 235); doc.line(left, 82, 572, 82); y = 103;
  };
  const room = (height: number) => { if (y + height > bottom) { doc.addPage(); header(); } };
  const paragraph = (value: unknown, size = 10, bold = false) => {
    const text = pdfText(value); if (!text) return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(text, width);
    for (const line of lines) {
      room(size * 1.45);
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(15, 23, 42);
      doc.text(line, left, y); y += size * 1.45;
    }
    y += 6;
  };
  const heading = (label: string) => {
    room(54); y += 7;
    doc.setFillColor(239, 243, 248); doc.roundedRect(left, y - 12, width, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    doc.text(label, left + 8, y + 3); y += 31;
  };
  const picture = (source: string, label: string, maxHeight: number) => {
    if (!source) return;
    // Failure must stop the archive; silently omitting a signature/photo is unacceptable.
    const dimensions = doc.getImageProperties(source);
    const scale = Math.min(width / dimensions.width, maxHeight / dimensions.height);
    const w = dimensions.width * scale, h = dimensions.height * scale;
    room(h + 42); paragraph(label, 9, true);
    doc.addImage(source, source.startsWith('data:image/png') ? 'PNG' : 'JPEG', left, y, w, h);
    y += h + 18;
  };
  header();
  paragraph(title, 16, true);
  paragraph(str(order.order_type), 11);
  heading('CONTRACTOR');
  picture(images.contractor_logo, 'Contractor logo', 60);
  paragraph(company, 12, true);
  for (const [label, value] of [['License', contractor.license ?? order.contractor_license], ['Phone', contractor.phone ?? order.contractor_phone], ['Email', contractor.email ?? order.contractor_email]]) if (value) paragraph(`${label}: ${str(value)}`);
  heading('CLIENT'); paragraph(client.name ?? order.client_name, 12, true);
  if (client.phone ?? order.client_phone) paragraph(`Phone: ${str(client.phone ?? order.client_phone)}`);
  heading('AUTHORIZED SCOPE'); paragraph(authorization.scope ?? order.description);
  heading('AMOUNT AND PAYMENT');
  const amount = Number(authorization.amount ?? order.cost);
  if (!Number.isFinite(amount)) throw new Error('The signed agreement amount is invalid. Export stopped.');
  paragraph(`${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${str(authorization.currency || 'USD')}`, 16, true);
  paragraph(`Payment status at export: ${str(order.payment_status || 'Not recorded').replace(/_/g, ' ')}`);
  heading('AUTHORIZATION AND PAYMENT TERMS'); paragraph(authorization.custom_terms ?? (order.custom_terms || defaultTerms));
  const consent = authorization.electronic_consent ?? order.consent_text;
  if (consent) { heading('ELECTRONIC CONSENT'); paragraph(consent); }
  if (images.photo_data || images.photo_data_2) {
    const first = doc.getImageProperties(images.photo_data || images.photo_data_2);
    room(Math.min(270, width * first.height / first.width) + 90);
    heading('AGREEMENT PHOTOS'); picture(images.photo_data, 'Photo 1', 270); picture(images.photo_data_2, 'Photo 2', 270);
  }
  if (requireSigned || images.signature_data) {
  room(230);
  heading('CLIENT ELECTRONIC SIGNATURE');
  paragraph(`Signed by: ${str(signature.signer_name ?? evidence?.signer_name ?? order.signer_name)}`);
  paragraph(`Signed at: ${date}`);
  picture(images.signature_data, 'Saved client signature', 105);
  }
  if (requireSigned && !evidence) paragraph('This copy uses the saved signed order. A separate signing-evidence record was not available for this legacy agreement.', 8);
  const pages = doc.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 100, 120);
    doc.text(requireSigned ? 'SignForth | Signed agreement export' : 'SignForth | Account export', left, 766); doc.text(`Page ${n} of ${pages}`, 572, 766, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

const hidden = /(^id$|_id$|sha256|byte_length|canonical|hash_algorithm|snapshot_version|document_hash|media_type|signing_token|payment_link)/;
const labels: Record<string, string> = { evidence_snapshot: 'Recorded agreement', custom_terms: 'Terms', electronic_consent: 'Electronic consent', signed_at_utc: 'Signed at (UTC)', occurred_at: 'Recorded at (UTC)', require_payment_upfront: 'Upfront payment requested', stripe_charges_enabled: 'Stripe payments enabled', stripe_details_submitted: 'Stripe details submitted', logo_data_url: 'Business logo' };
export async function accountReportPdf(title: string, record: Data, logo = '') {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = 94;
  const header = () => {
    doc.setFillColor(245, 158, 11); doc.rect(0, 0, 612, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(15, 23, 42); doc.text('SignForth | Account records', 40, 38);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(title, 40, 62); y = 94;
  };
  const line = (text: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10);
    if (bold && y > 699) { doc.addPage(); header(); }
    for (const part of doc.splitTextToSize(pdfText(text), 532)) {
      if (y > 733) { doc.addPage(); header(); }
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10); doc.text(part, 40, y); y += 15;
    }
    y += 6;
  };
  const walk = (r: Data, depth = 0) => {
    if (depth > 12) return;
    for (const [key, value] of Object.entries(r)) {
      if (hidden.test(key) || value == null || value === '' || /^(contractor_logo|photo_data|photo_data_2|signature_data|logo_data_url)$/.test(key)) continue;
      const label = labels[key] || (key[0].toUpperCase() + key.slice(1)).replace(/_/g, ' ');
      if (typeof value === 'object') {
        const nested = Array.isArray(value) ? Object.fromEntries(value.map((v, i) => [`Item ${i + 1}`, v])) : obj(value);
        if (!Object.entries(nested).some(([k,v]) => !hidden.test(k) && v != null)) continue;
        line(label, true); walk(nested, depth + 1);
      } else {
        if (typeof value === 'string' && /^(sfmedia:|data:image\/)/.test(value)) continue;
        line(label, true);
        line(typeof value === 'boolean' ? value ? 'Yes' : 'No' : ['status', 'event_type', 'payment_status', 'initial_payment_status'].includes(key) ? str(value).replace(/_/g, ' ') : str(value));
      }
    }
  };
  header();
  if (logo) {
    const d = doc.getImageProperties(logo); const scale = Math.min(180/d.width, 75/d.height);
    doc.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 40, y, d.width*scale, d.height*scale); y += d.height*scale+20;
  }
  walk(record);
  for (let n = 1; n <= doc.getNumberOfPages(); n++) {
    doc.setPage(n); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(85,100,120);
    doc.text(`SignForth | Exported account copy | Page ${n} of ${doc.getNumberOfPages()}`,40,766);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
