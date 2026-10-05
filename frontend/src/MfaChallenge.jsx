import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

// Second step of sign-in: enrol an authenticator app (first time) or enter its 6-digit code.
export default function MfaChallenge() {
  const { mfa, logout, startEnrollment, verifyMfa } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const enrolling = mfa.step === 'enroll';
  const enrollmentRequest = useRef(null); // one enrolment per screen, even if the effect runs twice (React StrictMode)

  useEffect(() => {
    if (!enrolling) return;
    let active = true;
    enrollmentRequest.current ??= startEnrollment();
    enrollmentRequest.current
      .then((next) => { if (active) setEnrollment(next); })
      .catch((err) => {
        enrollmentRequest.current = null;
        if (active) setError(err.message || 'Unable to start authenticator setup');
      });
    return () => { active = false; };
  }, [enrolling, startEnrollment]);

  const factorId = enrolling ? enrollment?.factorId : mfa.factorId;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyMfa(factorId, code);
    } catch (err) {
      setError(err.message || 'Unable to verify the code');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <span className="brand-mark">G</span>
        <h2 className="auth-title">{enrolling ? 'Set up two-factor sign-in' : 'Two-factor verification'}</h2>
        <p className="auth-sub">
          {enrolling
            ? 'Scan this QR code with an authenticator app (Microsoft Authenticator, Google Authenticator, Authy), then enter the 6-digit code.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>

        {enrolling && enrollment && (
          <>
            <img className="auth-qr" src={enrollment.qrCode} alt="Authenticator setup QR code" />
            <p className="auth-hint">Can't scan? Enter this key manually: <code>{enrollment.secret}</code></p>
          </>
        )}

        <label className="auth-field">
          <span>Authentication code</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoComplete="one-time-code"
            autoFocus
            required
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="auth-submit" disabled={busy || !factorId || code.length !== 6}>
          {busy ? 'Verifying…' : enrolling ? 'Enable and sign in' : 'Verify'}
        </button>
        <button type="button" className="auth-link" onClick={logout}>Use a different account</button>
      </form>
    </div>
  );
}
