import React, { useState } from 'react';
import { useAuth } from './AuthContext';

const MIN_LENGTH = 8;

// Shown after the user opens the recovery link from their email: choose a new password.
export default function ResetPassword() {
  const { completePasswordReset, cancelPasswordReset } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await completePasswordReset(password);
    } catch (err) {
      setError(err.message || 'Unable to reset your password');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <span className="brand-mark">G</span>
        <h2 className="auth-title">Choose a new password</h2>
        <p className="auth-sub">You'll sign in with it straight afterwards.</p>

        <label className="auth-field">
          <span>New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            required
          />
        </label>

        <label className="auth-field">
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'Saving…' : 'Reset password'}
        </button>
        <button type="button" className="auth-link" onClick={cancelPasswordReset}>
          Cancel
        </button>
      </form>
    </div>
  );
}
