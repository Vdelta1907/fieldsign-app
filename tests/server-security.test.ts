// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';

function load(name: string, createClient: any, Stripe: any = class {}) {
  let handler: any;
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    exports: {}, Response, URL, console: { error: vi.fn() },
    Deno: { serve: (fn: any) => { handler = fn; }, env: { get: () => 'https://fieldsign-app.vercel.app' } },
    require: (id: string) => id.includes('stripe@') ? Stripe : id.includes('supabase-js') ? { createClient } : {
      corsHeaders: {}, jsonResponse: (body: any, status = 200) => Response.json(body, { status }),
    },
  });
  return handler;
}
const request = (body: any) => new Request('https://example.com/function', {
  method: 'POST', headers: { Authorization: 'Bearer owner-a', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('Stripe status has no create side effect and a foreign ownership mapping never produces a link', async () => {
  let accountId: string | null = null;
  const createAccount = vi.fn(); const createLink = vi.fn();
  class Stripe { v2 = { core: { accounts: { create: createAccount, retrieve: async () => ({ metadata: { fieldsign_user_id: 'other-user' } }) }, accountLinks: { create: createLink } } }; }
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { stripe_account_id: accountId }, error: null }) };
  const handler = load('stripe-connect-onboard', () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-a' } } }) }, from: () => q }), Stripe);
  const status = await handler(request({ action: 'status' }));
  expect(await status.json()).toMatchObject({ user_id: 'owner-a', account_id: null, charges_enabled: false });
  expect(createAccount).not.toHaveBeenCalled();
  accountId = 'acct_other';
  expect((await handler(request({ action: 'open' }))).status).toBe(409);
  expect(createLink).not.toHaveBeenCalled();
});

test('a fully connected Stripe account returns a validated destination and owner identity', async () => {
  class Stripe {
    v2 = { core: { accounts: { retrieve: async () => ({ metadata: { fieldsign_user_id: 'owner-a' } }) } } };
    accounts = { retrieve: async () => ({ charges_enabled: true, details_submitted: true }) };
  }
  const q: any = { select: () => q, eq: () => q, update: () => q,
    maybeSingle: async () => ({ data: { stripe_account_id: 'acct_a' }, error: null }), then: (resolve: any) => resolve({ error: null }) };
  const handler = load('stripe-connect-onboard', () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-a' } } }) }, from: () => q }), Stripe);
  const response = await handler(request({ action: 'open' }));
  expect(await response.json()).toMatchObject({ user_id: 'owner-a', account_id: 'acct_a', url: 'https://dashboard.stripe.com/login' });
});

test('account changes require the current password for the same authenticated user', async () => {
  const updateUser = vi.fn(); const writeRequest = vi.fn();
  const auth = { getUser: async () => ({ data: { user: { id: 'a', email: 'a@example.com' } } }),
    signInWithPassword: async () => ({ data: { user: { id: 'b' }, session: {} }, error: null }),
    updateUser, signOut: async () => ({ error: null }) };
  const handler = load('account-security', () => ({ auth, from: writeRequest }));
  for (const action of ['email', 'password', 'request-deletion']) {
    expect((await handler(request({ action, currentPassword: 'incorrect', confirmation: 'DELETE' }))).status).toBe(403);
  }
  expect(updateUser).not.toHaveBeenCalled(); expect(writeRequest).not.toHaveBeenCalled();
});
