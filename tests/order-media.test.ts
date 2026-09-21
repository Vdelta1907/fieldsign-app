// @vitest-environment node
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, test, vi } from 'vitest';
import { hydrateOrderMedia, loadContractorOrderMedia } from '../src/lib/orderMedia';
import { clientAuthorization } from '../src/lib/clientAuthorization';
const value = 'data:image/png;base64,original-unaltered-data';
const ref = { field: 'contractor_logo', sha256: createHash('sha256').update(value).digest('hex'), byteLength: value.length, url: 'https://storage.example/signed' };
const order = { id: 'order', contractor_logo: null, _media: [ref] };
const client = () => ({ functions: { invoke: vi.fn(async () => ({ data: { data: order }, error: null })) } }) as unknown as SupabaseClient;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
test('media restores exact original values, reuses verified bytes briefly and isolates workspaces/access scopes', async () => {
  const fetcher = vi.fn(async () => new Response(value)); vi.stubGlobal('fetch', fetcher);
  const c = client();
  expect(await hydrateOrderMedia(c, order, 'owner')).toEqual({ id: 'order', contractor_logo: value });
  await hydrateOrderMedia(c, order, 'owner');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  await hydrateOrderMedia(c, order, 'another-token');
  await hydrateOrderMedia(client(), order, 'owner');
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 121000);
  await hydrateOrderMedia(c, order, 'owner');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
test('corrupt, truncated, oversized, duplicate and malformed references fail without substituting a logo', async () => {
  for (const body of [value.slice(1), value + 'extra', 'x'.repeat(value.length)]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(hydrateOrderMedia(client(), order, 'owner')).rejects.toThrow('verified or downloaded');
  }
  const fetcher = vi.fn(async () => new Response(value)); vi.stubGlobal('fetch', fetcher);
  await expect(hydrateOrderMedia(client(), { _media: [{ ...ref, field: 'owner_id' }] }, 'owner')).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(hydrateOrderMedia(client(), { _media: [ref, ref] }, 'owner')).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(hydrateOrderMedia(client(), order, 'owner', controller.signal)).rejects.toThrow('Aborted');
});
test('contractor downloads require a fresh gateway authorization even when bytes are cached; expired URL retries once', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockImplementation(async () => new Response(value));
  vi.stubGlobal('fetch', fetcher);
  const c = client();
  expect((await loadContractorOrderMedia(c, 'order')).contractor_logo).toBe(value);
  expect(c.functions.invoke).toHaveBeenCalledTimes(2);
  await loadContractorOrderMedia(c, 'order');
  expect(c.functions.invoke).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test('public gateway hydrates private media, preserves legacy inline orders and never accepts a partial failed download', async () => {
  const c = client(); const invoke = vi.mocked(c.functions.invoke);
  invoke.mockResolvedValue({ data: { data: [order] }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(value)));
  const result = await clientAuthorization(c, 'order', 'token');
  expect(result.error).toBeNull();
  expect(result.data[0].contractor_logo).toBe(value);
  expect(invoke.mock.calls[0][1]?.body).toMatchObject({ action: 'order-media', signingToken: 'token' });
  invoke.mockResolvedValue({ data: { data: [{ id: 'pending', contractor_logo: value }] }, error: null });
  expect((await clientAuthorization(c, 'order', 'token')).data[0].contractor_logo).toBe(value);
  invoke.mockResolvedValue({ data: { data: [order] }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('bad')));
  const failed = await clientAuthorization(c, 'order', 'different-token');
  expect(failed.data).toBeNull(); expect(failed.error).toBeTruthy();
});
