import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabase';
import { AuthScreen } from './AuthScreen';

const params = new URLSearchParams(window.location.search);
const hash = new URLSearchParams(window.location.hash.slice(1));
const clientToken = params.get('sign');
const verificationReturn = params.get('email-verified') === '1';
const recoveryReturn = params.get('reset-password') === '1' || hash.get('type') === 'recovery';
// Share initialization between StrictMode effect mounts; a verification token is single use.
let verification: Promise<void> | undefined;
function verifyEmail() {
  return verification ??= (async () => {
    const linkError = params.get('error_description') || hash.get('error_description');
    if (linkError) throw new Error(linkError);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email_confirmed_at) {
      throw new Error('This verification link is invalid or has expired. Request a fresh email.');
    }
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) throw new Error('Email verified, but session cleanup failed. Refresh to retry.');
    window.history.replaceState({}, '', window.location.pathname);
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
      void verifyEmail().then(() => {
        if (active) { setVerificationState('verified'); setReady(true); }
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
      <h1>{verificationState === 'verified' ? 'Email verified' : 'Verification unavailable'}</h1>
      <p role={verificationState === 'error' ? 'alert' : 'status'}>{message || 'Your email is verified. Sign in to continue.'}</p>
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
