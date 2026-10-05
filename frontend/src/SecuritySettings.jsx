import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

// Sidebar button + dialog where a signed-in user manages their authenticator devices.
export default function SecurityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="coordinator-logout" onClick={() => setOpen(true)}>Security</button>
      {open && <SecurityDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SecurityDialog({ onClose }) {
  const { listDevices, startEnrollment, confirmDevice, removeDevice } = useAuth();
  const [devices, setDevices] = useState(null);
  const [adding, setAdding] = useState(null); // { name, factorId, qrCode, secret } once enrolment has started
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDevices(await listDevices());
    } catch (err) {
      setError(err.message || 'Unable to load your devices');
    }
  }, [listDevices]);

  useEffect(() => { refresh(); }, [refresh]);

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const begin = (event) => {
    event.preventDefault();
    run(async () => setAdding({ ...(await startEnrollment(name.trim())) }));
  };

  const confirm = (event) => {
    event.preventDefault();
    run(async () => {
      try {
        await confirmDevice(adding.factorId, code);
      } catch (err) {
        setCode('');
        throw err;
      }
      cancelAdding();
      await refresh();
    });
  };

  function cancelAdding() {
    setAdding(null);
    setName('');
    setCode('');
  }

  const remove = (device) => run(async () => { await removeDevice(device.id); await refresh(); });

  return (
    <div className="security-overlay" role="dialog" aria-modal="true" aria-label="Security settings">
      <div className="auth-card security-card">
        <h2 className="auth-title">Security</h2>
        <p className="auth-sub">Devices that can generate your sign-in codes. Add a backup so losing one phone doesn't lock you out.</p>

        {devices === null ? <p className="auth-hint">Loading…</p> : (
          <ul className="security-devices">
            {devices.map((device) => (
              <li key={device.id}>
                <span>{device.name}</span>
                <button type="button" className="auth-link" disabled={busy || devices.length <= 1} onClick={() => remove(device)}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        {!adding ? (
          <form className="security-add" onSubmit={begin}>
            <label className="auth-field">
              <span>New device name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Backup phone" maxLength={40} required />
            </label>
            <button type="submit" className="auth-submit" disabled={busy || !name.trim()}>Add backup device</button>
          </form>
        ) : (
          <form className="security-add" onSubmit={confirm}>
            <p className="auth-sub">Scan this with the authenticator app on {adding.name}, then enter the code it shows.</p>
            <img className="auth-qr" src={adding.qrCode} alt="Backup device setup QR code" />
            <p className="auth-hint">Can't scan? Enter this key manually: <code>{adding.secret}</code></p>
            <label className="auth-field">
              <span>Authentication code</span>
              <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" required />
            </label>
            <button type="submit" className="auth-submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Confirm device'}</button>
            <button type="button" className="auth-link" onClick={cancelAdding}>Cancel</button>
          </form>
        )}

        {error && <p className="auth-error">{error}</p>}
        <button type="button" className="auth-link" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
