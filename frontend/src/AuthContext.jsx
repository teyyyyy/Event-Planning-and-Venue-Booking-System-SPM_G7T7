import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from './utils/supabase';

const AuthContext = createContext(null);
const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function toUser(session, profile = {}) {
  const u = session?.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: profile.name || u.user_metadata?.name || u.user_metadata?.full_name || u.email,
    role: profile.role || u.user_metadata?.role || '',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const hydrateUser = useCallback(async (session) => {
    const baseUser = toUser(session);
    if (!baseUser) return null;
    try {
      const response = await fetch(`${API}/users/${baseUser.id}/role`);
      const profile = response.ok ? await response.json() : null;
      if (!profile) console.error('Unable to load the signed-in user role.');
      return toUser(session, profile || {});
    } catch (error) {
      console.error('Unable to load the signed-in user role:', error.message);
      return toUser(session);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setUser(await hydrateUser(data.session));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      hydrateUser(session).then((nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setLoading(false);
      });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrateUser]);

  const login = useCallback(async (email, password) => {
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
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
