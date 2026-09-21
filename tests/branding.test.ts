import { expect, test } from 'vitest';
import { jsPDF } from 'jspdf';
import { BRANDING } from '../src/lib/branding';

test('default logo fits the order payload limit and can be embedded in a signed PDF', () => {
  expect(BRANDING.defaultLogo.startsWith('data:image/png;base64,')).toBe(true);
  expect(new TextEncoder().encode(BRANDING.defaultLogo).length).toBeLessThan(1500000);
  const pdf = new jsPDF();
  expect(() => pdf.addImage(BRANDING.defaultLogo, 'PNG', 10, 10, 20, 20)).not.toThrow();
  expect(pdf.getImageProperties(BRANDING.defaultLogo).width).toBe(512);
});


test('a verified private copy embeds in the PDF with the original dimensions', async () => {
  const { hydrateOrderMedia } = await import('../src/lib/orderMedia');
  const { createHash, webcrypto } = await import('node:crypto');
  const { vi } = await import('vitest');
  const source = BRANDING.defaultLogo;
  const originalCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source)));
  try {
    const order = await hydrateOrderMedia({} as never, { contractor_logo: '', _media: [{
      field: 'contractor_logo', sha256: createHash('sha256').update(source).digest('hex'),
      byteLength: new TextEncoder().encode(source).length, url: 'https://storage.example/signed',
    }] }, 'test-owner');
    expect(order.contractor_logo).toBe(source);
    const pdf = new jsPDF();
    pdf.addImage(order.contractor_logo, 'PNG', 10, 10, 20, 20);
    expect(pdf.getImageProperties(order.contractor_logo).width).toBe(512);
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  } finally { vi.unstubAllGlobals(); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }); }
});
