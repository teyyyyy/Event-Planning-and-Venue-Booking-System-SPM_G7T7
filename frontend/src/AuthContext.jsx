import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from './utils/supabase';

const AuthContext = createContext(null);
const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';
// Mirror of the backend's REQUIRE_MFA: set VITE_REQUIRE_MFA=false (with REQUIRE_MFA=false) to skip two-factor in local development.
const MFA_REQUIRED = String(import.meta.env.VITE_REQUIRE_MFA ?? 'true').trim().toLowerCase() !== 'false';

function toUser(session, profile = {}) {
  const u = session?.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: profile.name || u.user_metadata?.name || u.user_metadata?.full_name || u.email,
    role: profile.role || '',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // null, or { step: 'verify', factorId } / { step: 'enroll' } while a password-only session awaits its second factor.
  const [mfa, setMfa] = useState(null);
  // True while the user arrived from a password-recovery email link and must choose a new password.
  const [recovery, setRecovery] = useState(false);
  const recoveryRef = useRef(false);
  // One-off message for the sign-in screen (e.g. after a successful password reset).
  const [notice, setNotice] = useState('');

  const hydrateUser = useCallback(async (session) => {
    const baseUser = toUser(session);
    if (!baseUser) return null;
    try {
      const response = await fetch(`${API}/users/${baseUser.id}/role`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const profile = response.ok ? await response.json() : null;
      if (!profile) console.error('Unable to load the signed-in user role.');
      return toUser(session, profile || {});
    } catch (error) {
      console.error('Unable to load the signed-in user role:', error.message);
      return toUser(session);
    }
  }, []);

  // A session only becomes a signed-in user once it has completed the second factor (aal2).
  const resolveSession = useCallback(async (session) => {
    if (!session) return { user: null, mfa: null };
    if (!MFA_REQUIRED) return { user: await hydrateUser(session), mfa: null };
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') return { user: await hydrateUser(session), mfa: null };
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    return { user: null, mfa: factor ? { step: 'verify', factorId: factor.id } : { step: 'enroll' } };
  }, [hydrateUser]);

  useEffect(() => {
    let active = true;
    const apply = async (session) => {
      if (recoveryRef.current) return;
      const next = await resolveSession(session);
      if (!active || recoveryRef.current) return;
      setUser(next.user);
      setMfa(next.mfa);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        // The recovery link signs the user in with a password-only session; hold it back until a new password is set.
        recoveryRef.current = true;
        setRecovery(true);
        setUser(null);
        setMfa(null);
        setLoading(false);
        return;
      }
      apply(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveSession]);

  const login = useCallback(async (email, password) => {
    setNotice('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);
    return toUser(data.session);
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setUser(null);
      setMfa(null);
    }
  }, []);

  // Sends a recovery email. Never reveals whether the address has an account.
  const requestPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) throw new Error(error.message);
  }, []);

  // Sets the new password from a recovery session, then signs out so the user logs in normally (including MFA).
  const completePasswordReset = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    try {
      await supabase.auth.signOut();
    } finally {
      recoveryRef.current = false;
      setRecovery(false);
      setUser(null);
      setMfa(null);
      setNotice('Your password has been reset. Sign in with your new password.');
    }
  }, []);

  // Abandons a recovery session without changing the password.
  const cancelPasswordReset = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      recoveryRef.current = false;
      setRecovery(false);
      setUser(null);
      setMfa(null);
    }
  }, []);

  // Starts TOTP enrolment; resolves to { factorId, qrCode, secret } to show the user.
  const startEnrollment = useCallback(async (friendlyName = `Authenticator ${Date.now()}`) => {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    // Drop factors left half-enrolled by an abandoned attempt so a fresh one can be created.
    for (const stale of (factors?.all || []).filter((f) => f.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
    if (error) throw new Error(error.message);
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }, []);

  // Checks a 6-digit code for a factor (new or existing); on success the session is upgraded to aal2.
  const verifyMfa = useCallback(async (factorId, code) => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) throw new Error(error.message);
    const { data } = await supabase.auth.getSession();
    const next = await resolveSession(data.session);
    setUser(next.user);
    setMfa(next.mfa);
  }, [resolveSession]);

  // Devices (verified authenticators) on the signed-in account.
  const listDevices = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw new Error(error.message);
    return (data?.totp || []).map((f) => ({ id: f.id, name: f.friendly_name || 'Authenticator', createdAt: f.created_at }));
  }, []);

  // Confirms a newly enrolled backup device without touching the current session state.
  const confirmDevice = useCallback(async (factorId, code) => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) throw new Error(error.message);
  }, []);

  // Removes a device; the last one is kept so the account can't end up with no second factor.
  const removeDevice = useCallback(async (factorId) => {
    const devices = await listDevices();
    if (devices.length <= 1) throw new Error('You must keep at least one authenticator device.');
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new Error(error.message);
  }, [listDevices]);

  const value = useMemo(
    () => ({
      user, loading, mfa, recovery, notice, login, logout,
      requestPasswordReset, completePasswordReset, cancelPasswordReset,
      startEnrollment, verifyMfa, listDevices, confirmDevice, removeDevice,
    }),
    [user, loading, mfa, recovery, notice, login, logout, requestPasswordReset, completePasswordReset, cancelPasswordReset,
      startEnrollment, verifyMfa, listDevices, confirmDevice, removeDevice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
