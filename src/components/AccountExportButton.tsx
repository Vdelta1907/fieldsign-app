import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckCircle2, Download, LoaderCircle, TriangleAlert } from 'lucide-react';
import { exportAccount } from '../lib/accountExport';
import { chooseExportSink } from '../lib/exportZip';
import './AccountExportButton.css';

export function AccountExportButton({ client, accountId, isCurrent, busy, onBusyChange }: {
  client: SupabaseClient; accountId: string; isCurrent: () => boolean;
  busy: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [failed, setFailed] = useState(false);
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => { task.current?.abort(); }, [client, accountId]);
  const download = async () => {
    if (busy || task.current || !isCurrent()) return;
    const controller = new AbortController(); task.current = controller;
    setComplete(false); setFailed(false); setRunning(true); onBusyChange(true); setMessage('Preparing your download…');
    try {
      // Invoke the picker directly from the click so browser user activation is preserved.
      const sink = await chooseExportSink(`SignForth-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
      await exportAccount({ client, accountId, isCurrent, sink, signal: controller.signal,
        progress: text => { if (!controller.signal.aborted && isCurrent()) setMessage(text); } });
      if (isCurrent() && !controller.signal.aborted) {
        setComplete(true);
        setMessage('Your PDF archive was created successfully. Check your saved file or browser downloads, then unzip it and open START-HERE.pdf.');
      }
    } catch (error) {
      if (isCurrent()) {
        setFailed(true);
        setMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'Export cancelled. No complete export was created.'
        : error instanceof Error ? error.message : 'The export could not be completed. Please retry.');
      }
    } finally {
      task.current = null;
      if (isCurrent()) { setRunning(false); onBusyChange(false); }
    }
  };
  return <div className="account-export">
    <button className={`account-action account-export-button${complete ? ' export-complete' : ''}`} type="button" disabled={busy || running} aria-busy={running} onClick={() => void download()}>
      {running ? <LoaderCircle className="export-spinner" size={28} aria-hidden="true" /> : complete ? <CheckCircle2 size={28} aria-hidden="true" /> : <Download size={28} aria-hidden="true" />}
      <span><strong>{running ? 'Export in progress…' : complete ? 'Export successfully completed' : 'Download my account data'}</strong>
        <small>{running ? message : complete ? 'Create another export' : 'Complete signed agreements and account records, ready to use as PDFs.'}</small></span>
    </button>
    {!complete && !failed && <p className="export-help">A ZIP download of ready-to-use PDF documents, including complete signed agreements. Avoid editing orders during export. For large accounts, use desktop Chrome or Edge.</p>}
    {running && <div className="export-progress" role="progressbar" aria-label="Creating account export"><span /></div>}
    {message && <div className={`export-status${failed ? ' export-warning' : complete ? ' export-success' : ''}`} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {failed ? <TriangleAlert size={24} aria-hidden="true" /> : complete ? <CheckCircle2 size={24} aria-hidden="true" /> : null}
      <div>{(failed || complete) && <strong>{failed ? 'Export not completed' : 'Your next step'}</strong>}<p>{message}</p></div>
    </div>}
    {running && <button className="btn-secondary" type="button" onClick={() => task.current?.abort()}>Cancel export</button>}
  </div>;
}
