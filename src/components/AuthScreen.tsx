import { useRef, useState } from 'react';
import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password';

interface AuthScreenProps {
  recoveryMode?: boolean;
  onRecoveryComplete?: () => void;
}

export function AuthScreen({
  recoveryMode = false,
  onRecoveryComplete,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmedPassword, setConfirmedPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const authSubmissionInProgress = useRef(false);
const [accountCreatedEmail, setAccountCreatedEmail] =
  useState('');

  const showMessage = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmedPassword('');
    setMessage('');
    setIsError(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setIsError(false);

    if (
      (mode === 'sign-up' || recoveryMode) &&
      password.length < 8
    ) {
      showMessage('Your password must contain at least 8 characters.', true);
      return;
    }

    if (
      (mode === 'sign-up' || recoveryMode) &&
      password !== confirmedPassword
    ) {
      showMessage('The passwords do not match.', true);
      return;
    }

    if (authSubmissionInProgress.current) return;

authSubmissionInProgress.current = true;
setIsSubmitting(true);

    try {
      if (recoveryMode) {
        const { error } = await supabase.auth.updateUser({ password });

        if (error) throw error;

        showMessage('Your password has been updated successfully.');
        onRecoveryComplete?.();
        return;
      }

      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;
        return;
      }

      if (mode === 'sign-up') {
  const submittedEmail = email.trim();

  const { data, error } = await supabase.auth.signUp({
    email: submittedEmail,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) throw error;

  /*
   * Production registration requires email verification.
   * If Supabase unexpectedly returns a session, end it so
   * account creation never opens the contractor dashboard.
   */
  if (data.session) {
    const { error: signOutError } =
      await supabase.auth.signOut();

    if (signOutError) throw signOutError;
  }

  setPassword('');
  setConfirmedPassword('');
  setAccountCreatedEmail(submittedEmail);
  return;
}

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/?reset-password=1`,
        },
      );

      if (error) throw error;

      showMessage(
        'If an account exists for that email, a password-reset link has been sent.',
      );
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : 'We could not complete your request. Please try again.',
        true,
      );
   } finally {
  authSubmissionInProgress.current = false;
  setIsSubmitting(false);
}
  };

  const title = recoveryMode
    ? 'Create a new password'
    : mode === 'sign-up'
      ? 'Create your account'
      : mode === 'forgot-password'
        ? 'Reset your password'
        : 'Secure sign in';

  const description = recoveryMode
    ? 'Choose a new password with at least 8 characters.'
    : mode === 'sign-up'
      ? 'Create your secure FieldSign contractor account.'
      : mode === 'forgot-password'
        ? 'Enter your email and we’ll send you a secure reset link.'
        : 'Enter your email and password to access your dashboard.';

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden="true">
          <ShieldCheck size={28} strokeWidth={2.25} />
        </div>

        <span className="sub-tag">FieldSign Contractor Portal</span>
        <h1 id="auth-title">{title}</h1>
        <p>{description}</p>

        {accountCreatedEmail ? (
  <div
    role="status"
    aria-live="polite"
    style={{
      textAlign: 'center',
      padding: '8px 0 4px'
    }}
  >
    <div
      aria-hidden="true"
      style={{
        width: '58px',
        height: '58px',
        margin: '0 auto 16px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(16, 185, 129, 0.14)',
        border: '1px solid rgba(52, 211, 153, 0.45)',
        color: '#34d399',
        fontSize: '28px',
        fontWeight: 900
      }}
    >
      ✓
    </div>

    <h2
      style={{
        margin: 0,
        color: '#f8fafc',
        fontSize: '25px',
        fontWeight: 900
      }}
    >
      Account created
    </h2>

    <p
      style={{
        margin: '12px 0 0',
        color: '#cbd5e1',
        fontSize: '14px',
        lineHeight: 1.55
      }}
    >
      We sent a verification email to:
    </p>

    <p
      style={{
        margin: '5px 0 0',
        color: '#f59e0b',
        fontSize: '15px',
        fontWeight: 800,
        overflowWrap: 'anywhere'
      }}
    >
      {accountCreatedEmail}
    </p>

    <p
      style={{
        margin: '14px 0 0',
        color: '#94a3b8',
        fontSize: '13px',
        lineHeight: 1.55
      }}
    >
      Open the email and verify your address. Then return to
      SignForth and sign in.
    </p>

    <button
      type="button"
      className="btn-primary"
      onClick={() => {
        setAccountCreatedEmail('');
        changeMode('sign-in');
      }}
      style={{ marginTop: '20px' }}
    >
      Go to Login
    </button>
  </div>
) : (
  <form onSubmit={handleSubmit}>
          {!recoveryMode && (
            <>
              <label className="form-label" htmlFor="contractorEmail">
                Email address
              </label>

              <div className="auth-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input
                  id="contractorEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>
            </>
          )}

          {mode !== 'forgot-password' && (
            <>
              <label className="form-label" htmlFor="contractorPassword">
                {recoveryMode ? 'New password' : 'Password'}
              </label>

              <div className="auth-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  id="contractorPassword"
                  type="password"
                  autoComplete={
                    recoveryMode || mode === 'sign-up'
                      ? 'new-password'
                      : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  minLength={mode === 'sign-in' ? undefined : 8}
                  required
                />
              </div>
            </>
          )}

          {(mode === 'sign-up' || recoveryMode) && (
            <>
              <label className="form-label" htmlFor="confirmedPassword">
                Confirm password
              </label>

              <div className="auth-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  id="confirmedPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmedPassword}
                  onChange={(event) =>
                    setConfirmedPassword(event.target.value)
                  }
                  placeholder="Enter it again"
                  minLength={8}
                  required
                />
              </div>
            </>
          )}

          <button
            className="btn-primary"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? 'Please wait…'
              : recoveryMode
                ? 'Save new password'
                : mode === 'sign-up'
                  ? 'Create secure account'
                  : mode === 'forgot-password'
                    ? 'Send password-reset link'
                    : 'Sign in securely'}
          </button>
          </form>
)}

        {message && (
          <p
            className="auth-message"
            role={isError ? 'alert' : 'status'}
            style={isError ? { color: '#f87171' } : undefined}
          >
            {message}
          </p>
        )}

        {!recoveryMode && (
          <div style={{ marginTop: '18px', textAlign: 'center' }}>
            {mode === 'sign-in' && (
              <>
                <button
                  type="button"
                  onClick={() => changeMode('forgot-password')}
                  style={{
                    display: 'block',
                    margin: '0 auto 12px',
                    border: 0,
                    background: 'transparent',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Forgot password?
                </button>

                <span style={{ color: '#94a3b8', fontSize: '13px' }}>
                  New to FieldSign?{' '}
                </span>

                <button
                  type="button"
                  onClick={() => changeMode('sign-up')}
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: '#f59e0b',
                    cursor: 'pointer',
                    fontWeight: 800,
                  }}
                >
                  Create an account
                </button>
              </>
            )}

            {mode !== 'sign-in' && (
              <button
                type="button"
                onClick={() => changeMode('sign-in')}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: '#38bdf8',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ← Return to sign in
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
