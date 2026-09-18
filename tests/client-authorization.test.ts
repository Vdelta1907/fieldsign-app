// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test, vi } from 'vitest';
import { clientAuthorization, ClientRateLimitError } from '../src/lib/clientAuthorization';

test('polling honors Retry-After, resumes afterwards, and does not block another workspace or writes', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValueOnce({ data: null, error: { context: Response.json({ error: 'Limited' }, { status: 429, headers: { 'Retry-After': '20' } }) } })
    .mockResolvedValue({ data: { data: { state: 'active' } }, error: null });
  const client = { functions: { invoke } } as unknown as SupabaseClient;
  try {
    expect((await clientAuthorization(client, 'state', 'token')).error).toBeInstanceOf(ClientRateLimitError);
    expect((await clientAuthorization(client, 'order', 'token')).error).toBeInstanceOf(ClientRateLimitError);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((await clientAuthorization(client, 'respond', 'token')).error).toBeNull();
    const another = { functions: { invoke } } as unknown as SupabaseClient;
    expect((await clientAuthorization(another, 'state', 'token')).error).toBeNull();
    vi.advanceTimersByTime(20_000);
    expect((await clientAuthorization(client, 'state', 'token')).data).toEqual({ state: 'active' });
  } finally { vi.useRealTimers(); }
});

test('response retries forward the same submission ID and abort signals are preserved', async () => {
  const invoke = vi.fn().mockResolvedValue({ data: { data: { already_recorded: true } }, error: null });
  const client = { functions: { invoke } } as unknown as SupabaseClient;
  const signal = new AbortController().signal;
  const options = { signal, response: 'declined', note: null, submissionId: 'same-id' };
  await clientAuthorization(client, 'respond', 'token', options);
  await clientAuthorization(client, 'respond', 'token', options);
  expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1]);
  expect(invoke).toHaveBeenCalledWith('client-authorization', { body: { action: 'respond', signingToken: 'token', response: 'declined', note: null, submissionId: 'same-id' }, signal });
});
