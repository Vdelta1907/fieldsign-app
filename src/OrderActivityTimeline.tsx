import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Activity = {
  id: string;
  event_type: string;
  revision_number: number;
  occurred_at: string;
  details: Record<string, unknown>;
};

type Props = {
  client: SupabaseClient;
  orderId: string;
  refreshKey: string;
};

const labels: Record<string, string> = {
  order_created: 'Order Created',
  ready_for_client_review: 'Ready for Client Review',
  changes_requested: 'Changes Requested',
  order_declined: 'Order Declined',
  order_signed: 'Order Signed',
  order_cancelled: 'Order Cancelled',
  revision_started: 'Revision Started',
  order_status_changed: 'Order Status Updated',
  payment_status_changed: 'Payment Status Updated',
  order_archived: 'Order Archived',
  order_unarchived: 'Order Restored'
};

// Display precedence for events sharing an exact timestamp.
// This does not change their recorded timestamps.
const priority: Record<string, number> = {
  order_created: 0,
  revision_started: 1,
  order_status_changed: 2,
  ready_for_client_review: 3,
  changes_requested: 4,
  order_declined: 4,
  order_signed: 4,
  order_cancelled: 4,
  payment_status_changed: 5,
  order_archived: 6,
  order_unarchived: 6
};

export default function OrderActivityTimeline({
  client,
  orderId,
  refreshKey
}: Props) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;

    let active = true;

    const load = async () => {
      setLoading(true);
      setError('');
      setEvents([]);

      try {
        const { data, error: queryError } = await client
          .from('order_activity')
          .select(
            'id,event_type,revision_number,occurred_at,details'
          )
          .eq('order_id', orderId)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(200);

        if (queryError) throw queryError;
        if (!active) return;

        const rows = (data || []) as Activity[];

        rows.sort((a, b) => {
          const timeOrder =
            a.occurred_at.localeCompare(b.occurred_at);

          if (timeOrder !== 0) return timeOrder;

          return (
            a.revision_number - b.revision_number ||
            (priority[a.event_type] ?? 99) -
              (priority[b.event_type] ?? 99) ||
            a.id.localeCompare(b.id)
          );
        });

        setEvents(rows);
      } catch {
        if (active) {
          setError('Activity could not be loaded. Please retry.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [client, orderId, refreshKey, open, reload]);

  return (
    <section style={{ marginTop: '10px' }}>
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '10px',
          borderRadius: '9px',
          border: '1px solid #334155',
          background: '#0b1120',
          color: '#cbd5e1',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer'
        }}
      >
        {open ? '▲ Hide Order Activity' : '▼ Order Activity'}
      </button>

      {open && (
        <div
          aria-busy={loading}
          style={{
            marginTop: '7px',
            padding: '10px',
            borderRadius: '9px',
            border: '1px solid #334155',
            background: '#0b1120',
            color: '#cbd5e1',
            fontSize: '12px'
          }}
        >
          <button
            type="button"
            disabled={loading}
            onClick={() => setReload(value => value + 1)}
            style={{
              padding: '8px 10px',
              borderRadius: '7px',
              border: '1px solid #334155',
              background: '#131b2e',
              color: '#7dd3fc',
              cursor: loading ? 'wait' : 'pointer'
            }}
          >
            {loading ? 'Loading…' : error ? 'Retry' : 'Refresh'}
          </button>

          {loading && <p role="status">Loading order activity…</p>}
          {error && <p role="alert">{error}</p>}

          {!loading && !error && events.length === 0 && (
            <p>No recorded activity is available for this order.</p>
          )}

          {!loading && !error && events.length > 0 && (
            <>
              <p style={{ color: '#94a3b8', fontSize: '11px' }}>
                Recorded activity, oldest first.
                {events.length === 200 &&
                  ' Showing the latest 200 events.'}
              </p>

              <ol style={{ paddingLeft: '20px', marginBottom: 0 }}>
                {events.map(event => (
                  <li
                    key={event.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid #1e293b'
                    }}
                  >
                    <strong style={{ color: '#e2e8f0' }}>
                      {labels[event.event_type] || 'Order Updated'}
                    </strong>

                    {event.event_type === 'payment_status_changed' && (
                      <p style={{ margin: '5px 0' }}>
                        {String(
                          event.details.previous_payment_status ??
                            'Not recorded'
                        )}
                        {' → '}
                        {String(
                          event.details.new_payment_status ??
                            'Not recorded'
                        )}
                      </p>
                    )}

                    <div
                      style={{
                        marginTop: '5px',
                        color: '#94a3b8',
                        fontSize: '11px'
                      }}
                    >
                      Revision {event.revision_number}
                      {' · '}
                      <time dateTime={event.occurred_at}>
                        {new Date(event.occurred_at).toLocaleString()}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}