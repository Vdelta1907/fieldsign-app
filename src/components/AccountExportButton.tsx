import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Download } from 'lucide-react';
import { exportAccount } from '../lib/accountExport';
import { chooseExportSink } from '../lib/exportZip';

export function AccountExportButton({ client, accountId, isCurrent, busy, onBusyChange }: {
  client: SupabaseClient; accountId: string; isCurrent: () => boolean;
  busy: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => { task.current?.abort(); }, [client, accountId]);
  const download = async () => {
    if (busy || task.current || !isCurrent()) return;
    const controller = new AbortController(); task.current = controller;
    setRunning(true); onBusyChange(true); setMessage('Preparing your download…');
    try {
      // Invoke the picker directly from the click so browser user activation is preserved.
      const sink = await chooseExportSink(`SignForth-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
      await exportAccount({ client, accountId, isCurrent, sink, signal: controller.signal,
        progress: text => { if (!controller.signal.aborted && isCurrent()) setMessage(text); } });
      if (isCurrent() && !controller.signal.aborted) setMessage('Export ready. Unzip the download and open START-HERE.pdf to browse your records.');
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'Export cancelled. No complete export was created.'
        : error instanceof Error ? error.message : 'The export could not be completed. Please retry.');
    } finally {
      task.current = null;
      if (isCurrent()) { setRunning(false); onBusyChange(false); }
    }
  };
  return <div>
    <button className="account-action" type="button" disabled={busy} onClick={() => void download()}>
      <Download size={20} aria-hidden="true" /><span><strong>Download my account data</strong>
        <small>Complete signed agreements, other orders and account records, including retained archived orders.</small></span>
    </button>
    <p>A ZIP download of ready-to-use PDF documents, including complete signed agreements. Avoid editing orders during export. For large accounts, use desktop Chrome or Edge.</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {running && <button className="btn-secondary" type="button" onClick={() => task.current?.abort()}>Cancel export</button>}
  </div>;
}
