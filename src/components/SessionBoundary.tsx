import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabase';
import { AuthScreen } from './AuthScreen';

const params = new URLSearchParams(window.location.search);
const hash = new URLSearchParams(window.location.hash.slice(1));
const clientToken = params.get('sign');
// Secure email changes return a message after the first inbox confirmation,
// and an authenticated email_change callback only after the second.
const firstEmailConfirmation = [params.get('message'), hash.get('message')].some(
  value => value === 'Confirmation link accepted. Please proceed to confirm link sent to the other email',
);
const emailChangeReturn = hash.get('type') === 'email_change' || params.get('type') === 'email_change';
const verificationReturn = params.get('email-verified') === '1' || emailChangeReturn || firstEmailConfirmation;
const recoveryReturn = params.get('reset-password') === '1' || hash.get('type') === 'recovery';
// Share initialization between StrictMode effect mounts; a verification token is single use.
type VerificationResult = 'verified' | 'pending' | 'changed';
let verification: Promise<VerificationResult> | undefined;
function verifyEmail() {
  return verification ??= (async () => {
    const linkError = params.get('error_description') || hash.get('error_description');
    if (linkError) throw new Error(linkError);
    // This is informational guidance, never authentication or authorization.
    // Supabase has not issued a session at this stage; do not require one.
    if (firstEmailConfirmation) return 'pending';
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email_confirmed_at) {
      throw new Error('This verification link is invalid or has expired. Request a fresh email.');
    }
    if (emailChangeReturn && data.user.new_email) return 'pending';
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) throw new Error('Email verified, but session cleanup failed. Refresh to retry.');
    window.history.replaceState({}, '', window.location.pathname);
    return emailChangeReturn ? 'changed' : 'verified';
  })();
}

export default function SessionBoundary() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(Boolean(clientToken));
  const [epoch, setEpoch] = useState(0);
  const [recovery, setRecovery] = useState(recoveryReturn);
  const [verificationState, setVerificationState] = useState(verificationReturn ? 'processing' : 'none');
  const [message, setMessage] = useState('');
  const identity = useRef<{ id: string | null; generation: number }>({ id: null, generation: 0 });
  const verificationBlocked = useRef(verificationReturn);

  useEffect(() => {
    if (clientToken) return;
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active || verificationBlocked.current) return;
      const id = next?.user.id ?? null;
      if (identity.current.id !== id) {
        identity.current = { id, generation: identity.current.generation + 1 };
        setEpoch(identity.current.generation);
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next);
      setReady(true);
    });
    if (verificationReturn) {
      void verifyEmail().then((result) => {
        if (active) { setVerificationState(result); setReady(true); }
      }).catch((error: unknown) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Verification could not finish.');
          setVerificationState('error');
          setReady(true);
        }
      });
    }
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!ready) return <div className="app-loading" role="status">{verificationReturn ? 'Verifying your email…' : 'Opening SignForth…'}</div>;
  if (verificationState !== 'none') return (
    <main className="auth-shell"><section className="auth-card">
      <span className="sub-tag">SignForth Contractor Portal</span>
      <h1>{verificationState === 'pending' ? 'Check your other inbox'
        : verificationState === 'changed' ? 'Email address updated'
        : verificationState === 'verified' ? 'Email verified' : 'Verification unavailable'}</h1>
      <p role={verificationState === 'error' ? 'alert' : 'status'}>{message || (
        verificationState === 'pending'
          ? 'One confirmation has been received. Open the separate confirmation email in your other inbox (your current or new email address). Click that link once to finish changing your email. Your email change is not complete yet.'
          : verificationState === 'changed'
            ? 'Your sign-in email has been updated. Sign in with your new email address and your existing password.'
            : 'Your email is verified. Sign in to continue.'
      )}</p>
      {verificationState === 'error' && <p>If this was an email change and you already clicked this link, check your other inbox for the separate confirmation email. If both confirmations are complete, try signing in with your new email. Otherwise, sign in and request a new email change from Account settings.</p>}
      <button className="btn-primary" onClick={async () => {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) { setMessage('Could not finish signing out. Please retry.'); return; }
        window.history.replaceState({}, '', window.location.pathname);
        verificationBlocked.current = false;
        setSession(null);
        setVerificationState('none');
      }}>Go to Login</button>
    </section></main>
  );
  if (recovery && !clientToken) return <AuthScreen recoveryMode onRecoveryComplete={() => {
    setRecovery(false);
    window.history.replaceState({}, '', window.location.pathname);
  }} />;
  if (!session && !clientToken) return <AuthScreen />;
  const generation = epoch;
  return <App key={clientToken ? 'client' : `${session!.user.id}:${epoch}`}
    session={session} clientToken={clientToken}
    isCurrent={() => Boolean(clientToken) || identity.current.generation === generation}
    onSession={(next) => {
      if (identity.current.generation !== generation) return;
      if ((next?.user.id ?? null) !== identity.current.id) {
        identity.current = { id: next?.user.id ?? null, generation: generation + 1 };
        setEpoch(generation + 1);
      }
      setSession(next);
    }} />;
}
