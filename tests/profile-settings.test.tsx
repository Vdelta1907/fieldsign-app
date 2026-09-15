import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rows: {} as Record<string, any>, queries: [] as any[], status: {} as Record<string, any> }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { refreshSession: vi.fn(), signOut: vi.fn() } } }));
vi.mock('../src/lib/workspaceClient', () => ({ createWorkspaceClient: (userId: string) => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    from: (table: string) => {
      const q: any = { select: () => q, eq: (key: string, value: string) => { mock.queries.push({ table, key, value }); return q; },
        is: () => q, order: () => q, abortSignal: () => table === 'contractor_profiles' ? q : Promise.resolve({ data: [], error: null }),
        maybeSingle: async () => ({ data: mock.rows[userId] ?? null, error: null }) };
      return q;
    },
    channel: () => channel, removeChannel: vi.fn(),
    functions: { invoke: async () => ({ data: { user_id: userId, ...mock.status[userId] }, error: null }) },
  };
} }));
import App from '../src/App';
afterEach(cleanup);
const session = (id: string) => ({ user: { id, email: `${id}@example.com` } } as any);
async function settings() {
  fireEvent.click(await screen.findByLabelText('Open account menu'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Branding & Stripe Setup' }));
}
test('real Settings renders each account profile, new-account defaults, and isolated Stripe state', async () => {
  mock.rows.a = { user_id: 'a', company_name: 'Company A', custom_terms: 'Private terms A', use_default_terms: false,
    stripe_account_id: 'acct_a', stripe_charges_enabled: true, stripe_details_submitted: true };
  mock.status.a = { account_id: 'acct_a', charges_enabled: true, details_submitted: true };
  mock.status.b = { account_id: null, charges_enabled: false, details_submitted: false };
  localStorage.setItem('fieldsign_contractor_profile', JSON.stringify({ companyName: 'Stale company', stripeAccountId: 'acct_stale' }));
  const view = render(<App key="a" session={session('a')} clientToken={null} isCurrent={() => true} onSession={() => {}} />);
  await settings();
  await screen.findByRole('button', { name: 'Manage Stripe account' });
  expect(screen.getByDisplayValue('Company A')).toBeTruthy();
  expect(screen.getByDisplayValue('Private terms A')).toBeTruthy();
  view.rerender(<App key="b" session={session('b')} clientToken={null} isCurrent={() => true} onSession={() => {}} />);
  expect(screen.queryByDisplayValue('Company A')).toBeNull();
  await settings();
  await screen.findByRole('button', { name: 'Connect with Stripe' });
  expect(screen.queryByDisplayValue('Private terms A')).toBeNull();
  expect(screen.queryByDisplayValue('Stale company')).toBeNull();
  expect(screen.getByDisplayValue('b@example.com')).toBeTruthy();
  const toggle = screen.getByRole('switch', { name: 'Use default terms' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  const terms = screen.getByLabelText('Custom authorization terms') as HTMLTextAreaElement;
  expect(terms.value).toBe('');
  fireEvent.change(terms, { target: { value: 'Custom B draft' } });
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect((screen.getByLabelText('Custom authorization terms') as HTMLTextAreaElement).value).toBe('Custom B draft');
  await waitFor(() => expect(mock.queries).toContainEqual({ table: 'contractor_profiles', key: 'user_id', value: 'b' }));
});
