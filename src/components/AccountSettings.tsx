import { useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { supabase as authClient } from '../lib/supabase';

function SecretInput({ id, label, value, onChange, autoComplete = 'current-password' }: {
  id: string; label: string; value: string; onChange: (value: string) => void; autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="account-field"><label htmlFor={id}>{label}</label>
    <div className="account-secret"><input id={id} type={visible ? 'text' : 'password'}
      value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} required />
      <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button>
    </div></div>;
}

export function AccountSettings({ session, client, isCurrent, onBack }: {
  session: Session; client: SupabaseClient; isCurrent: () => boolean; onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const submit = async (action: 'email' | 'password' | 'request-deletion') => {
    if (lock.current || !isCurrent()) return;
    setMessage(''); setError(false);
    if (!currentPassword) { setError(true); setMessage('Enter your current password to confirm your identity.'); return; }
    if (action === 'password' && (password.length < 8 || password !== confirmPassword)) {
      setError(true); setMessage('Use at least 8 characters and matching passwords.'); return;
    }
    lock.current = true; setBusy(true);
    try {
      const { data, error: invokeError } = await client.functions.invoke('account-security', {
        body: { action, currentPassword, email: email.trim(), password, confirmation },
      });
      if (!isCurrent()) return;
      if (invokeError) {
        const details = 'context' in invokeError && invokeError.context instanceof Response
          ? await invokeError.context.clone().json().catch(() => null) : null;
        throw new Error(details?.error || 'The account change could not be completed. Please retry.');
      }
      setCurrentPassword(''); setPassword(''); setConfirmPassword(''); setConfirmation('');
      setMessage(data.message);
      if (action === 'password') {
        // Server revokes other sessions; clear this browser as well.
        await authClient.auth.signOut({ scope: 'local' });
        window.location.assign(window.location.pathname);
      }
      if (action === 'request-deletion') setDeleting(false);
    } catch (reason) {
      if (isCurrent()) { setError(true); setMessage(reason instanceof Error ? reason.message : 'Please retry.'); }
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="card-dark account-settings">
    <span className="sub-tag">Your SignForth login</span><h2>Account settings</h2>
    <p>Signed in as <strong>{session.user.email}</strong></p>
    <p>Business contact information is managed separately in Branding &amp; Stripe Setup.</p>
    <fieldset disabled={busy}>
      <SecretInput id="account-current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} />
      <p>Required to verify your identity before changing your account.</p>
      <form onSubmit={e => { e.preventDefault(); void submit('email'); }}>
        <h3>Change email address</h3><label htmlFor="account-new-email">New email address</label>
        <input id="account-new-email" type="email" autoComplete="email" value={email} required onChange={e => setEmail(e.target.value)} />
        <p>Follow the verification instructions sent to your email addresses. Your login email stays unchanged until confirmation is complete.</p>
        <button className="btn-secondary" type="submit">Verify email change</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); void submit('password'); }}>
        <h3>Change password</h3>
        <SecretInput id="account-new-password" label="New password" autoComplete="new-password" value={password} onChange={setPassword} />
        <SecretInput id="account-confirm-password" label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />
        <p role="status">{confirmPassword ? (password === confirmPassword ? 'Passwords match.' : 'Passwords do not match.') : 'Use at least 8 characters.'}</p>
        <p>After the password changes, sign in again on your devices.</p>
        <button className="btn-secondary" type="submit">Update password</button>
      </form>
      <section className="account-danger">
        <h3><TriangleAlert size={22} aria-hidden="true" /> Account deletion</h3>
        <p>Request removal of your account and editable profile. Signed authorizations, payment records, and evidence require review before deletion. This request does not delete your Stripe account.</p>
        {!deleting ? <button className="account-delete" type="button" onClick={() => setDeleting(true)}>Request account deletion</button> :
          <form onSubmit={e => { e.preventDefault(); void submit('request-deletion'); }}>
            <p>Your request will be recorded for review. Your account remains active until that review is completed.</p>
            <label htmlFor="delete-confirmation">Type DELETE to confirm your request</label>
            <input id="delete-confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="off" />
            <button className="account-delete" type="submit" disabled={confirmation !== 'DELETE'}>Confirm deletion request</button>
            <button type="button" className="btn-secondary" onClick={() => { setDeleting(false); setConfirmation(''); }}>Cancel</button>
          </form>}
      </section>
    </fieldset>
    {busy && <p role="status">Verifying and saving…</p>}
    {message && <p role={error ? 'alert' : 'status'} style={{ color: error ? '#fca5a5' : '#6ee7b7' }}>{message}</p>}
    <button className="btn-secondary" type="button" disabled={busy} onClick={onBack}>Return to dashboard</button>
  </section>;
}
