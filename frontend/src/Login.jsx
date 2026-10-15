import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export default function Login() {
  const { login, requestPasswordReset, notice } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'forgot'
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Unable to send the recovery email');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setSent(false);
  }

  if (mode === 'forgot') {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={handleForgot}>
          <span className="brand-mark">G</span>
          <h2 className="auth-title">Reset password</h2>
          <p className="auth-sub">Enter your email and we'll send you a recovery link.</p>

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          {sent && (
            <p className="auth-success" role="status">
              If an account exists for that email, a recovery link has been sent. Check your inbox.
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Sending…' : sent ? 'Resend link' : 'Send recovery link'}
          </button>
          <button type="button" className="auth-link" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <span className="brand-mark">G</span>
        <h2 className="auth-title">Sign in</h2>
        <p className="auth-sub">Welcome back to Gather</p>

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {notice && <p className="auth-success" role="status">{notice}</p>}
        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
          Forgot password?
        </button>
      </form>
    </div>
  );
}
