import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DashboardCategory = 'active' | 'draft' | 'pending' | 'signed' | 'attention';
export type DashboardSummary = {
  allCount: number; draftCount: number; pendingCount: number; signedCount: number;
  attentionCount: number; paidCount: number; totalApprovedRevenue: number; totalPaidRevenue: number;
};
const emptySummary: DashboardSummary = {
  allCount: 0, draftCount: 0, pendingCount: 0, signedCount: 0,
  attentionCount: 0, paidCount: 0, totalApprovedRevenue: 0, totalPaidRevenue: 0,
};
type Cursor = { id: string; created_at: string };
type Page<T> = { orders: T[]; summary: DashboardSummary; selected_count: number; has_more: boolean; next_cursor: Cursor | null };
export function matchesDashboardCategory(status: string, category: DashboardCategory | null) {
  if (category === 'active') return true;
  if (category === 'pending') return ['pending', 'changes_requested', 'declined'].includes(status);
  if (category === 'attention') return ['changes_requested', 'declined'].includes(status);
  return category !== null && status === category;
}

export function useDashboardOrders<T extends { id: string }>(
  client: SupabaseClient, userId: string | undefined, category: DashboardCategory | null, enabled: boolean,
) {
  const [orders, setOrders] = useState<T[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [selectedCount, setSelectedCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);
  const pages = useRef(1);
  const cursor = useRef<Cursor | null>(null);
  const lastMode = useRef<'refresh' | 'more'>('refresh');
  const listRef = useRef<HTMLDivElement>(null);

  const cancel = useCallback(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
    pendingRefresh.current = false;
  }, []);
  useLayoutEffect(() => {
    cancel(); pages.current = 1; cursor.current = null;
    setOrders([]); setHasMore(false); setSelectedCount(0); setError('');
    setLoading(false); setLoadingMore(false);
    if (listRef.current) listRef.current.scrollTop = 0;
    return cancel;
  }, [userId, category, enabled, cancel]);
  useLayoutEffect(() => { setSummary(emptySummary); }, [userId]);

  const run = useCallback(async (mode: 'refresh' | 'more'): Promise<boolean> => {
    if (!enabled || !userId) return false;
    if (active.current) {
      if (mode === 'refresh') pendingRefresh.current = true;
      return false;
    }
    if (mode === 'more' && (!category || !cursor.current)) return false;
    const revision = generation.current;
    const controller = new AbortController();
    active.current = controller;
    lastMode.current = mode;
    setError('');
    if (mode === 'more') setLoadingMore(true);
    setLoading(true);
    // Refresh only already-loaded pages. Every request still returns at most ten.
    const wanted = mode === 'more' ? 1 : pages.current;
    let after = mode === 'more' ? cursor.current : null;
    let result: Page<T> | null = null;
    const fresh: T[] = [];
    let completed = 0;
    try {
      for (let page = 0; page < wanted; page++) {
        const timer = setTimeout(() => controller.abort(), 12_000);
        try {
          const { data, error: readError } = await client.rpc('signforth_dashboard_page', {
            p_category: category, p_before_created_at: after?.created_at ?? null, p_before_id: after?.id ?? null,
          }).abortSignal(controller.signal);
          if (readError) throw readError;
          if (revision !== generation.current || controller.signal.aborted) return false;
          result = data as Page<T>;
          if (!result || !Array.isArray(result.orders) || result.orders.length > 10 || !result.summary ||
              typeof result.has_more !== 'boolean' || (result.has_more && !result.next_cursor)) {
            throw new Error('Invalid dashboard response');
          }
          fresh.push(...result.orders);
          completed++;
          after = result.next_cursor;
          if (!result.has_more || category === null) break;
        } finally { clearTimeout(timer); }
      }
      if (!result || revision !== generation.current) return false;
      const deduplicate = (rows: T[]) => Array.from(new Map(rows.map(row => [row.id, row])).values());
      setOrders(previous => deduplicate(mode === 'more' ? [...previous, ...fresh] : fresh));
      setSummary(result.summary); setSelectedCount(result.selected_count); setHasMore(result.has_more);
      cursor.current = result.next_cursor;
      pages.current = mode === 'more' ? pages.current + 1 : Math.max(1, completed);
      return true;
    } catch {
      if (revision === generation.current) {
        setError(mode === 'more' ? 'More orders could not be loaded. Please try again.'
          : 'The dashboard could not be refreshed. Please try again.');
      }
      return false;
    } finally {
      if (revision === generation.current) {
        active.current = null; setLoading(false); setLoadingMore(false);
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          void run('refresh');
        }
      }
    }
  }, [client, userId, category, enabled]);
  // Keep the existing caller's silent-refresh signature; background refreshes do
  // not replace cards with a loading screen or reset the list's scroll position.
  const refresh = useCallback((_silent = false) => run('refresh'), [run]);
  const loadMore = useCallback(() => run('more'), [run]);
  const retry = useCallback(() => run(lastMode.current), [run]);
  return { orders, setOrders, summary, selectedCount, hasMore, loading, loadingMore, error, refresh, loadMore, retry, cancel, listRef };
}
