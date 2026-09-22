import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDashboardOrders, type DashboardCategory } from '../src/hooks/useDashboardOrders';
const summary = { allCount: 25, draftCount: 1, pendingCount: 12, signedCount: 12, attentionCount: 3, paidCount: 2, totalApprovedRevenue: 1000, totalPaidRevenue: 100 };
const rows = (start: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: String(start + n) }));
const page = (start: number, count = 10, more = true) => ({ orders: rows(start, count), summary, selected_count: 25,
  has_more: more, next_cursor: more ? { id: String(start + count - 1), created_at: '2026-01-01' } : null });
function client() { const transport = vi.fn(); return { transport, rpc: vi.fn((name, args) => ({ abortSignal: (signal: AbortSignal) => transport(name, args, signal) })) }; }
afterEach(cleanup);

test('loads ten more without changing scroll; refreshes loaded pages; category changes reset rows, cursor and scroll', async () => {
  const c = client();
  c.transport.mockImplementation(async (_name, args) => ({ data: args.p_before_id ? page(11) : page(1), error: null }));
  const hook = renderHook(({ category }: { category: DashboardCategory }) => useDashboardOrders<{ id: string }>(c as never, 'owner', category, true), { initialProps: { category: 'active' } });
  const list = document.createElement('div'); hook.result.current.listRef.current = list;
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.orders).toHaveLength(10);
  expect(hook.result.current.summary.totalApprovedRevenue).toBe(1000);
  list.scrollTop = 300;
  await act(async () => { await hook.result.current.loadMore(); });
  expect(hook.result.current.orders).toHaveLength(20); expect(list.scrollTop).toBe(300);
  expect(c.rpc.mock.calls[1][1].p_before_id).toBe('10');
  await act(async () => { await hook.result.current.refresh(true); });
  expect(hook.result.current.orders).toHaveLength(20); expect(list.scrollTop).toBe(300);
  hook.rerender({ category: 'pending' });
  expect(hook.result.current.orders).toEqual([]); expect(list.scrollTop).toBe(0);
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.orders).toHaveLength(10);
  expect(c.rpc.mock.lastCall?.[1]).toEqual({ p_category: 'pending', p_before_created_at: null, p_before_id: null });
});

test('an old category/account response is ignored even when transport does not honor abort', async () => {
  const c = client(); let resolve: (result: any) => void = () => {};
  c.transport.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const hook = renderHook(({ user, category }: { user: string; category: DashboardCategory }) => useDashboardOrders(c as never, user, category, true), { initialProps: { user: 'a', category: 'active' } });
  let pending: Promise<boolean>;
  act(() => { pending = hook.result.current.refresh(); });
  hook.rerender({ user: 'b', category: 'signed' });
  await act(async () => { resolve({ data: page(1), error: null }); await pending; });
  expect(hook.result.current.orders).toEqual([]); expect(hook.result.current.summary.allCount).toBe(0);
  expect(c.transport.mock.calls[0][2].aborted).toBe(true);
});

test('load-more failures preserve rows and retry the same cursor; duplicate clicks cannot overlap', async () => {
  const c = client(); c.transport.mockResolvedValueOnce({ data: page(1), error: null });
  const hook = renderHook(() => useDashboardOrders(c as never, 'a', 'active', true));
  await act(async () => { await hook.result.current.refresh(); });
  c.transport.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await act(async () => { await hook.result.current.loadMore(); });
  expect(hook.result.current.orders).toHaveLength(10); expect(hook.result.current.error).toContain('More orders');
  c.transport.mockResolvedValueOnce({ data: page(11, 5, false), error: null });
  await act(async () => { await Promise.all([hook.result.current.retry(), hook.result.current.loadMore()]); });
  expect(c.transport).toHaveBeenCalledTimes(3);
  expect(hook.result.current.orders).toHaveLength(15); expect(hook.result.current.hasMore).toBe(false);
  expect(c.rpc.mock.calls[1][1]).toEqual(c.rpc.mock.calls[2][1]);
});

test('refresh during load-more is queued and a failed refresh never replaces an existing list', async () => {
  const c = client(); c.transport.mockResolvedValueOnce({ data: page(1), error: null });
  const hook = renderHook(() => useDashboardOrders(c as never, 'a', 'active', true));
  await act(async () => { await hook.result.current.refresh(); });
  let resolve: (value: any) => void = () => {};
  c.transport.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let pending: Promise<boolean>;
  act(() => { pending = hook.result.current.loadMore(); });
  await act(async () => { await hook.result.current.refresh(true); });
  c.transport.mockResolvedValue({ data: null, error: new Error('unavailable') });
  await act(async () => { resolve({ data: page(11), error: null }); await pending; });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(c.transport).toHaveBeenCalledTimes(3); expect(hook.result.current.orders).toHaveLength(20);
});
