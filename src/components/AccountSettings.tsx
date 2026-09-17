import { useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Eye, EyeOff, KeyRound, Mail, TriangleAlert } from 'lucide-react';
import { supabase as authClient } from '../lib/supabase';

type AccountAction = 'email' | 'password' | 'request-deletion';

function SecretInput({ id, label, value, onChange, autoComplete = 'current-password', required = true }: {
  id: string; label: string; value: string; onChange: (value: string) => void; autoComplete?: string; required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="account-field"><label htmlFor={id}>{label}</label>
    <div className="account-secret"><input id={id} type={visible ? 'text' : 'password'}
      value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} required={required} />
      <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button>
    </div></div>;
}

export function AccountSettings({ session, client, isCurrent, onBack }: {
  session: Session; client: SupabaseClient; isCurrent: () => boolean; onBack: () => void;
}) {
  const [panel, setPanel] = useState<AccountAction | null>(null);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<AccountAction | ''>('');
  const lock = useRef(false);

  const closePanel = () => {
    if (busy) return;
    setPanel(null); setEmail(''); setCurrentPassword('');
    setPassword(''); setConfirmPassword(''); setConfirmation('');
  };

  const openPanel = (action: AccountAction) => {
    if (action === 'request-deletion' && !window.confirm(
      'Request account deletion?\\n\\nThis starts a review. Signed authorizations and payment records may need to be retained. Your Stripe account will not be deleted. Continue?',
    )) return;
    closePanel();
    setPanel(action);
  };

  const submit = async (action: AccountAction) => {
    if (lock.current || !isCurrent()) return;
    if (!currentPassword) { window.alert('Enter your current password to confirm your identity.'); return; }
    if (action === 'password' && (password.length < 8 || password !== confirmPassword)) {
      window.alert('Use at least 8 characters and matching passwords.'); return;
    }
    lock.current = true; setBusy(true); setActiveAction(action);
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
      window.alert(data.message || 'Your request was completed.');
      if (action === 'password') {
        await authClient.auth.signOut({ scope: 'local' });
        window.location.assign(window.location.pathname);
        return;
      }
      setPanel(null); setEmail(''); setCurrentPassword('');
      setPassword(''); setConfirmPassword(''); setConfirmation('');
    } catch (reason) {
      if (isCurrent()) window.alert(reason instanceof Error ? reason.message : 'Please retry.');
    } finally { lock.current = false; setBusy(false); setActiveAction(''); }
  };

  return <section className="card-dark account-settings">
    <span className="sub-tag">Your SignForth login</span><h2>Account settings</h2>
    <p>Signed in as <strong>{session.user.email}</strong></p>
    <p>Choose the account detail you want to manage. Business information is managed separately in Branding &amp; Stripe Setup.</p>

    {!panel && <div className="account-actions" aria-label="Account actions">
      <button className="account-action" type="button" onClick={() => openPanel('email')}>
        <Mail size={20} aria-hidden="true" /><span><strong>Change email address</strong><small>Update the email used to sign in.</small></span>
      </button>
      <button className="account-action" type="button" onClick={() => openPanel('password')}>
        <KeyRound size={20} aria-hidden="true" /><span><strong>Change password</strong><small>Create a new SignForth password.</small></span>
      </button>
      <button className="account-action danger" type="button" onClick={() => openPanel('request-deletion')}>
        <TriangleAlert size={20} aria-hidden="true" /><span><strong>Request account deletion</strong><small>Submit your account for deletion review.</small></span>
      </button>
    </div>}

    {panel === 'email' && <form className="account-panel" onSubmit={e => { e.preventDefault(); void submit('email'); }}>
      <h3><Mail size={20} aria-hidden="true" /> Change email address</h3>
      <SecretInput id="email-current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} required={false} />
      <label htmlFor="account-new-email">New email address</label>
      <input id="account-new-email" type="email" autoComplete="email" value={email} required onChange={e => setEmail(e.target.value)} />
      <p>Follow the instructions sent to both email addresses. Your login email remains unchanged until both confirmations are complete.</p>
      <div className="account-panel-actions"><button className="btn-primary" type="submit" disabled={busy}>{activeAction === 'email' ? 'Verifying email change…' : 'Verify email change'}</button><button className="btn-secondary" type="button" disabled={busy} onClick={closePanel}>Cancel</button></div>
    </form>}

    {panel === 'password' && <form className="account-panel" onSubmit={e => { e.preventDefault(); void submit('password'); }}>
      <h3><KeyRound size={20} aria-hidden="true" /> Change password</h3>
      <SecretInput id="password-current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} required={false} />
      <SecretInput id="account-new-password" label="New password" autoComplete="new-password" value={password} onChange={setPassword} />
      <SecretInput id="account-confirm-password" label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />
      <p role="status">{confirmPassword ? (password === confirmPassword ? 'Passwords match.' : 'Passwords do not match.') : 'Use at least 8 characters.'}</p>
      <p>After the password changes, sign in again on your devices.</p>
      <div className="account-panel-actions"><button className="btn-primary" type="submit" disabled={busy}>{activeAction === 'password' ? 'Updating password…' : 'Update password'}</button><button className="btn-secondary" type="button" disabled={busy} onClick={closePanel}>Cancel</button></div>
    </form>}

    {panel === 'request-deletion' && <form className="account-panel account-danger" onSubmit={e => { e.preventDefault(); void submit('request-deletion'); }}>
      <h3><TriangleAlert size={22} aria-hidden="true" /> Account deletion</h3>
      <p>Your request will be reviewed. Signed authorizations, payment records, and evidence may need to be retained. This does not delete your Stripe account.</p>
      <SecretInput id="deletion-current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} required={false} />
      <label htmlFor="delete-confirmation">Type DELETE to confirm your request</label>
      <input id="delete-confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="off" />
      <div className="account-panel-actions"><button className="account-delete" type="submit" disabled={busy || confirmation !== 'DELETE'}>{activeAction === 'request-deletion' ? 'Submitting request…' : 'Confirm deletion request'}</button><button className="btn-secondary" type="button" disabled={busy} onClick={closePanel}>Cancel</button></div>
    </form>}

    <button className="btn-secondary account-back" type="button" disabled={busy} onClick={onBack}>Return to dashboard</button>
  </section>;
}
