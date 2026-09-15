import { beforeEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ options: null as any, getSession: vi.fn(), create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (_url: any, _key: any, options: any) => { mock.options = options; return {}; } }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: mock.getSession } } }));
import { createWorkspaceClient } from '../src/lib/workspaceClient';
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
test('an old workspace cannot acquire the next account token', async () => {
  createWorkspaceClient('a', () => true);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'b' }, access_token: 'b-secret' } }, error: null });
  await expect(mock.options.accessToken()).rejects.toThrow('changed');
});
test('a response completing after the account changes is discarded', async () => {
  let active = true;
  createWorkspaceClient('a', () => active);
  let finish: any;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = mock.options.global.fetch('/profile');
  active = false; finish(new Response('{}'));
  await expect(pending).rejects.toThrow('ended');
});
test('a disposed workspace sends no further requests, including an A to B to A switch', async () => {
  createWorkspaceClient('a', () => false);
  await expect(mock.options.global.fetch('/profile')).rejects.toThrow('ended');
  expect(fetch).not.toHaveBeenCalled();
});
