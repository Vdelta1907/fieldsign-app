// @vitest-environment node
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import * as limits from '../supabase/functions/_shared/client-limits';
import * as futureMedia from '../supabase/functions/_shared/future-media';

const token = 'abcdefab-1234-4234-8234-123456789abc';
const submissionId = '11111111-1234-4234-8234-123456789abc';
function load(name: string, rpc: ReturnType<typeof vi.fn>) {
  let handler: (request: Request) => Promise<Response> = () => { throw new Error('Missing handler'); };
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  vm.runInNewContext(code, {
    exports: {}, Response, URL, crypto: webcrypto, console: { error: vi.fn() },
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: () => 'https://signforth.example' } },
    require: (id: string) => id.includes('supabase-js') ? { createClient: () => ({ rpc }) } : id.includes('future-media') ? futureMedia : limits,
  });
  return handler;
}
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://example.com', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: 'https://signforth.example', ...headers },
});
const signature = { signingToken: token, submissionId, signerName: 'Client', signatureData: 'data:image/png;base64,abc', consentText: 'existing consent', paymentRequested: false };

test('gateway only forwards approved operations after the committed limiter check', async () => {
  const rpc = vi.fn(async (name: string) => ({ error: null, data: name === 'signforth_consume_client_limit' ? { allowed: true } : { state: 'active' } }));
  const handler = load('client-authorization', rpc);
  expect(await (await handler(request({ action: 'state', signingToken: token }))).json()).toEqual({ data: { state: 'active' } });
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['signforth_consume_client_limit', 'fieldsign_get_link_state']);
  expect(rpc).toHaveBeenNthCalledWith(1, 'signforth_consume_client_limit', { p_kind: 'read', p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  rpc.mockClear();
  const response = await handler(request({ action: 'respond', signingToken: token, response: 'declined', submissionId, note: null }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('fieldsign_submit_client_response_v2', { p_signing_token: token, p_response: 'declined', p_submission_id: submissionId, p_note: null });
  rpc.mockClear();
  expect((await handler(request({ action: 'order', signingToken: token }))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('get_order_for_signing', { p_token: token });
  rpc.mockClear();
  expect((await handler(request({ action: 'arbitrary_rpc', signingToken: token }))).status).toBe(400);
  expect((await handler(request({ action: ['state'], signingToken: token }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

test.each(['client-authorization', 'submit-signature'])('%s returns 429 with Retry-After and fails closed when the limiter is unavailable', async name => {
  const rpc = vi.fn(async () => ({ data: { allowed: false, retry_after: 23 }, error: null as unknown }));
  const handler = load(name, rpc);
  const body = name === 'submit-signature' ? signature : { action: 'state', signingToken: token };
  const headers = { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'test browser' };
  const limited = await handler(request(body, headers));
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('23');
  expect(limited.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  expect(limited.headers.get('Cache-Control')).toBe('no-store');
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } });
  expect((await handler(request(body, headers))).status).toBe(503);
  expect(rpc.mock.calls.every(call => call[0] === 'signforth_consume_client_limit')).toBe(true);
});

test('signature retry keeps the submission ID, evidence inputs, original timestamp and hash', async () => {
  const result = { signed_at_utc: '2026-09-18T12:00:00Z', payment_status: 'unpaid', document_hash: 'original-hash', already_recorded: true };
  const rpc = vi.fn(async (name: string) => ({ data: name === 'signforth_consume_client_limit' ? { allowed: true } : name === 'signforth_uploads_enabled' ? false : result, error: null }));
  const handler = load('submit-signature', rpc);
  const response = await handler(request(signature, { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'test browser' }));
  expect(await response.json()).toEqual({ signedAtUtc: result.signed_at_utc, paymentStatus: 'unpaid', documentHash: 'original-hash', alreadyRecorded: true });
  expect(rpc).toHaveBeenLastCalledWith('fieldsign_sign_order_with_evidence', {
    p_token: token, p_submission_id: submissionId, p_signer_name: 'Client', p_signature_data: signature.signatureData,
    p_consent_text: signature.consentText, p_payment_requested: false, p_signing_ip: '192.0.2.1', p_user_agent: 'test browser',
  });
});

test.each(['client-authorization', 'submit-signature'])('%s rejects malformed/oversized JSON and disallowed origins before database access', async name => {
  const rpc = vi.fn(); const handler = load(name, rpc);
  expect((await handler(request('{'))).status).toBe(400);
  expect((await handler(request(null))).status).toBe(400);
  expect((await handler(request({ padding: 'x'.repeat(800_001) }))).status).toBe(413);
  expect((await handler(request(signature, { Origin: 'https://unrelated.example' }))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

test('body byte bound handles streamed chunks without Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(6)); controller.close(); } });
  const streamed = new Request('https://example.com', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await expect(limits.readClientBody(streamed, 10)).rejects.toMatchObject({ status: 413 });
});

test('token capitalization cannot obtain a fresh budget', async () => {
  const rpc = vi.fn(async () => ({ data: { allowed: true }, error: null }));
  await limits.enforceClientLimit({ rpc }, token, 'read');
  await limits.enforceClientLimit({ rpc }, token.toUpperCase(), 'read');
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
});
