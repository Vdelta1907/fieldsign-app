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
