// @vitest-environment node
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import * as media from '../supabase/functions/_shared/order-media';
import * as limits from '../supabase/functions/_shared/client-limits';

const owner = '00000000-0000-4000-8000-000000000011';
const orderId = '00000000-0000-4000-8000-000000000001';
const value = 'data:image/png;base64,original';
function fixture() {
  const storage = { upload: vi.fn(async () => ({ error: null as any })), download: vi.fn(async () => ({ data: new Blob([value]), error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://example/signed' }, error: null })) };
  const rpc = vi.fn(async (name: string) => ({ error: null, data: name === 'signforth_next_media_order'
    ? { id: orderId, owner_id: owner, contractor_logo: value, signature_data: value } : null }));
  const admin = { rpc, storage: { from: vi.fn(() => storage) }, auth: { getUser: vi.fn(async () => ({ data: { user: { id: owner } }, error: null as any })) } };
  return { storage, rpc, admin: admin as any };
}
function handler(name: string, admin: any, preparationSecret = 'a'.repeat(64)) {
  let serve: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText, {
    exports: {}, Response, URL, crypto: webcrypto, console: { error: vi.fn() },
    Deno: { serve: (fn: typeof serve) => { serve = fn; }, env: { get: (key: string) => key === 'SIGNFORTH_MEDIA_PREPARATION_SECRET' ? preparationSecret : key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'server-secret' : 'https://signforth.example' } },
    require: (id: string) => id.includes('supabase-js') ? { createClient: () => admin } : id.includes('order-media') ? media : limits,
  });
  return (body: unknown = {}, authorization?: string, mediaSecret?: string) => serve(new Request('https://example', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}), ...(mediaSecret ? { 'x-signforth-media-secret': mediaSecret } : {}) },
  }));
}
test('preparer copies exact bytes, verifies before publishing and reuses same-owner duplicates without overwrite', async () => {
  const { admin, rpc, storage } = fixture();
  expect(await media.prepareNextSignedMedia(admin)).toBe(true);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.upload.mock.calls[0][1]).toEqual(new TextEncoder().encode(value));
  expect(storage.upload.mock.calls[0][2]).toEqual({ contentType: 'text/plain', cacheControl: '0', upsert: false });
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['signforth_next_media_order', 'signforth_register_order_media', 'signforth_register_order_media', 'signforth_finish_media_order']);
  expect(storage.download.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  storage.upload.mockResolvedValue({ error: { statusCode: '409' } });
  expect(await media.prepareNextSignedMedia(admin)).toBe(true);
  storage.upload.mockResolvedValue({ error: { statusCode: '400' } });
  expect(await media.prepareNextSignedMedia(admin)).toBe(true);
});
test('preparer refuses corrupt existing content and upload failures without marking it complete', async () => {
  const { admin, rpc, storage } = fixture();
  storage.upload.mockResolvedValue({ error: { statusCode: '409' } });
  storage.download.mockResolvedValue({ data: new Blob(['corrupt']), error: null });
  await expect(media.prepareNextSignedMedia(admin)).rejects.toThrow('verification failed');
  expect(rpc).toHaveBeenCalledTimes(1);
  storage.upload.mockResolvedValue({ error: { statusCode: '500' } });
  await expect(media.prepareNextSignedMedia(admin)).rejects.toThrow('upload failed');
  expect(rpc.mock.calls.every(call => call[0] === 'signforth_next_media_order')).toBe(true);
});
test('authorized URLs live for 60 seconds and response omits separate raw paths', async () => {
  const { admin, storage } = fixture();
  const result = await media.authorizeOrderMedia(admin, { id: orderId, _media: [{ field: 'contractor_logo', path: 'owner/hash.txt', sha256: 'hash', byteLength: 10 }] });
  expect(storage.createSignedUrl).toHaveBeenCalledWith('owner/hash.txt', 60);
  expect(result?._media[0]).toEqual({ field: 'contractor_logo', sha256: 'hash', byteLength: 10, url: 'https://example/signed' });
});
test('administrative preparer denies missing, ordinary-user and incorrect secrets before touching storage', async () => {
  const { admin, rpc, storage } = fixture(); const invoke = handler('prepare-order-media', admin);
  for (const token of [undefined, 'Bearer ordinary-user', 'Bearer wrong-secret']) expect((await invoke({}, token)).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled(); expect(storage.upload).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: null, error: null });
  expect((await invoke({}, 'Bearer server-secret')).status).toBe(403);
  expect((await invoke({}, undefined, 'a'.repeat(64))).status).toBe(200);
});
test('contractor endpoint verifies user identity and ignores a supplied owner; unavailable orders return 404', async () => {
  const { admin, rpc, storage } = fixture(); const invoke = handler('contractor-order-media', admin);
  expect((await invoke({ orderId })).status).toBe(401);
  admin.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('invalid') });
  expect((await invoke({ orderId }, 'Bearer invalid')).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockImplementation(async (name: string) => ({ data: name === 'signforth_consume_client_limit' ? { allowed: true } : null, error: null }));
  expect((await invoke({ orderId, ownerId: 'someone-else' }, 'Bearer real-user')).status).toBe(404);
  expect(rpc).toHaveBeenLastCalledWith('signforth_get_order_media', { p_order_id: orderId, p_owner_id: owner });
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
  rpc.mockImplementation(async (name: string) => ({ data: name === 'signforth_consume_client_limit' ? { allowed: true } : { id: orderId, _media: [] }, error: null }));
  expect((await invoke({ orderId }, 'Bearer real-user')).status).toBe(200);
});
test('public media endpoint keeps rate limiting before token lookup and supports missing orders', async () => {
  const { admin, rpc } = fixture(); const invoke = handler('client-authorization', admin);
  rpc.mockImplementation(async (name: string) => ({ data: name === 'signforth_consume_client_limit' ? { allowed: true } : null, error: null }));
  const response = await invoke({ action: 'order-media', signingToken: orderId });
  expect(await response.json()).toEqual({ data: [] });
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['signforth_consume_client_limit', 'signforth_get_order_media']);
  expect(rpc).toHaveBeenLastCalledWith('signforth_get_order_media', { p_token: orderId });
});

test.each(['client-authorization', 'contractor-order-media', 'prepare-order-media'])('Dashboard %s is a current self-contained copy of its source and helpers', name => {
  const root = new URL('../supabase/', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
  const entry = read(`functions/${name}/index.ts`).replace(/^import .* from '\.\.\/_shared\/[^']+';\n/gm, '');
  const expected = '// GENERATED: run node scripts/build-private-media-dashboard.mjs after editing shared/source functions.\n'
    + (name === 'prepare-order-media' ? '' : read('functions/_shared/client-limits.ts') + '\n')
    + read('functions/_shared/order-media.ts') + '\n' + entry;
  expect(read(`dashboard-private-media/${name}.ts`)).toBe(expected);
});


test('preparation rejects wrong/short dedicated secrets and ignores forged service-role JWT claims', async () => {
  const { admin, rpc, storage } = fixture(); const invoke = handler('prepare-order-media', admin);
  const forged = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ role: 'service_role', ref: 'signforth' })).toString('base64url') + '.fake';
  for (const credential of ['b'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'short']) {
    expect((await invoke({}, 'Bearer ' + forged, credential)).status).toBe(403);
  }
  expect(rpc).not.toHaveBeenCalled(); expect(storage.upload).not.toHaveBeenCalled();
});

test.each(['', 'weak-secret'])('preparation fails closed when the dedicated secret is missing or malformed (%s)', async value => {
  const { admin, rpc } = fixture(); const invoke = handler('prepare-order-media', admin, value);
  const response = await invoke({}, 'Bearer server-secret', 'a'.repeat(64));
  expect(response.status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

test('preparation accepts its dedicated secret independently of Authorization and does not return it', async () => {
  const { admin, rpc } = fixture(); const invoke = handler('prepare-order-media', admin);
  rpc.mockResolvedValue({ data: null, error: null });
  const response = await invoke({}, 'Bearer unrelated-user-token', 'a'.repeat(64));
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('a'.repeat(64));
});
