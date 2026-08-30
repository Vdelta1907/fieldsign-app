import { useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function AuthScreen() {
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState('');

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setIsSending(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });

    setIsSending(false);
    setMessage(error ? error.message : 'Check your email for your secure sign-in link.');
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden="true">
          <ShieldCheck size={28} strokeWidth={2.25} />
        </div>
        <span className="sub-tag">FieldSign Contractor Portal</span>
        <h1 id="auth-title">Secure sign in</h1>
        <p>Enter your business email. We’ll send you a private sign-in link—no password required.</p>

        <form onSubmit={sendMagicLink}>
          <label className="form-label" htmlFor="contractorEmail">Business email</label>
          <div className="auth-input-wrap">
            <Mail size={17} aria-hidden="true" />
            <input
              id="contractorEmail"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={isSending}>
            {isSending ? 'Sending secure link…' : 'Email me a sign-in link'}
          </button>
        </form>

        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  );
}
