import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('Home Screen launch reserves an opaque status bar instead of overlaying the header', () => {
  const html = readFileSync('index.html', 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes');
  expect(document.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveLength(1);
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('black');
  expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain('viewport-fit=cover');
});
