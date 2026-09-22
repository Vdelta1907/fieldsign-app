import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), realtime: () => {} }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { refreshSession: vi.fn(), signOut: vi.fn() } } }));
vi.mock('../src/lib/workspaceClient', () => ({ createWorkspaceClient: (userId: string) => {
  const channel = { on: (_event: unknown, _filter: unknown, callback: () => void) => { mock.realtime = callback; return channel; }, subscribe: () => channel };
  return {
    from: () => {
      const q: any = { select: () => q, eq: () => q, abortSignal: () => q,
        maybeSingle: async () => ({ data: { user_id: userId, company_name: 'Test Contractor', custom_terms: '' }, error: null }) };
      return q;
    },
    rpc: (name: string, args: any) => ({ abortSignal: (signal: AbortSignal) => mock.rpc(name, args, signal) }),
    channel: () => channel, removeChannel: vi.fn(),
    functions: { invoke: async () => ({ data: { user_id: userId, charges_enabled: false }, error: null }) },
  };
} }));
import App from '../src/App';
const summary = { allCount: 25, draftCount: 2, pendingCount: 20, signedCount: 3, attentionCount: 15, paidCount: 1, totalApprovedRevenue: 50, totalPaidRevenue: 10 };
const orders = Array.from({ length: 25 }, (_, n) => ({ id: String(n + 1), project_title: `Order ${n + 1}`, client_name: 'Test client', client_phone: '555', cost: 1,
  created_at: '2026-01-01T12:00:00Z', status: n < 11 ? 'declined' : n < 15 ? 'changes_requested' : n < 20 ? 'pending' : n < 23 ? 'signed' : 'draft', payment_status: 'unpaid' }));
function response(args: any) {
  const filtered = !args.p_category ? [] : orders.filter(o => args.p_category === 'active' ||
    (args.p_category === 'pending' && ['pending', 'changes_requested', 'declined'].includes(o.status)) ||
    (args.p_category === 'attention' && ['changes_requested', 'declined'].includes(o.status)) || o.status === args.p_category);
  const start = args.p_before_id ? filtered.findIndex(o => o.id === args.p_before_id) + 1 : 0;
  const rows = filtered.slice(start, start + 10); const more = start + 10 < filtered.length;
  return { data: { orders: rows, summary, selected_count: filtered.length, has_more: more,
    next_cursor: more ? { id: rows.at(-1)!.id, created_at: rows.at(-1)!.created_at } : null }, error: null };
}
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  mock.rpc.mockReset(); mock.rpc.mockImplementation(async (_name, args) => response(args));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function dashboard() {
  render(<App session={{ user: { id: 'owner', email: 'test@example.com' } } as any} clientToken={null} isCurrent={() => true} onSession={() => {}} />);
  await screen.findByRole('button', { name: 'All Orders: 25 orders' });
}

test('real dashboard attention banner opens only responses, paginates ten, and Pending includes declined labels', async () => {
  await dashboard();
  expect(screen.queryByText('Order 1')).toBeNull();
  const banner = screen.getByRole('button', { name: /15 client responses require your attention/ });
  fireEvent.click(banner);
  await screen.findByText('Order 1');
  expect(banner.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Needs attention')).toBeTruthy();
  expect(screen.queryByText('Order 11')).toBeNull();
  expect(screen.getByText('Showing 10 of 15 orders')).toBeTruthy();
  const list = screen.getByLabelText('Orders list'); list.scrollTop = 400;
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('Order 15');
  expect(list.scrollTop).toBe(400);
  expect(screen.queryByText('Order 16')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pending: 20 orders' }));
  await screen.findByText('Order 1');
  expect(list.scrollTop).toBe(0);
  expect(screen.queryByText('Order 11')).toBeNull();
  expect(screen.getAllByText('× Declined')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'All Orders: 25 orders' })).toBeTruthy();
  expect(screen.getByText('$50.00')).toBeTruthy();
});

test('switching away and back starts from the first ten; collapse retains document lock', async () => {
  await dashboard();
  fireEvent.click(screen.getByRole('button', { name: 'All Orders: 25 orders' }));
  await screen.findByText('Order 1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('Order 20');
  const list = screen.getByLabelText('Orders list'); list.scrollTop = 500;
  fireEvent.click(screen.getByRole('button', { name: 'Signed: 3 orders' }));
  await screen.findByText('Order 21'); expect(list.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'All Orders: 25 orders' }));
  await screen.findByText('Order 1'); expect(screen.queryByText('Order 11')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All Orders: 25 orders' }));
  expect(screen.queryByText('Order 1')).toBeNull();
  expect(document.documentElement.classList.contains('dashboard-document-lock')).toBe(true);
  expect(document.querySelector('.dashboard-collapsed')).toBeTruthy();
});

test('real dashboard exposes retry after a failed page and retains successful cards', async () => {
  await dashboard();
  fireEvent.click(screen.getByRole('button', { name: 'All Orders: 25 orders' }));
  await screen.findByText('Order 1');
  mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert'); expect(screen.getByText('Order 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Order 20');
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => { mock.realtime(); });
  await waitFor(() => expect(screen.getByLabelText('Orders list').getAttribute('aria-busy')).toBe('false'));
  expect(screen.getByText('Order 20')).toBeTruthy();
});
