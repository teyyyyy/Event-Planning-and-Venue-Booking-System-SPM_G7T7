import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch } from '../test/helpers';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('../utils/supabase', () => ({ supabase: { auth } }));

import { AuthProvider, useAuth } from '../AuthContext';

const session = (extra = {}) => ({ user: { id: 'u1', email: 'a@x.com', user_metadata: {}, ...extra } });
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
let authListener;

describe('AuthContext', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.onAuthStateChange.mockImplementation((cb) => { authListener = cb; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; });
    auth.signOut.mockResolvedValue({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const mount = async () => {
    const view = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
  };

  tc('FE-AUTH-001', 'useAuth', 'The hook is used outside an AuthProvider.', 'It throws "useAuth must be used within an AuthProvider".',
    { kind: 'Negative', steps: '1. Render useAuth() with no provider.' },
    () => { expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider'); });

  tc('FE-AUTH-002', 'AuthProvider', 'App starts with no stored session.', 'user is null and loading becomes false.',
    { pre: 'getSession resolves with no session.', steps: '1. Mount the provider. 2. Wait for loading to finish.' },
    async () => { const { result } = await mount(); expect(result.current.user).toBeNull(); });

  tc('FE-AUTH-003', 'AuthProvider', 'A stored session exists and the backend returns the user profile.', 'user carries the id and email from the session and the name and role from the profile.',
    { pre: 'Session for u1; GET /users/u1/role returns name "Ann", role "Event Coordinator".', steps: '1. Mount the provider. 2. Wait for loading to finish.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      const fetchMock = mockFetch(() => json({ name: 'Ann', role: 'Event Coordinator' }));
      const { result } = await mount();
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/users\/u1\/role$/);
      expect(result.current.user).toEqual({ id: 'u1', email: 'a@x.com', name: 'Ann', role: 'Event Coordinator' });
    });

  tc('FE-AUTH-004', 'AuthProvider', 'Role lookup returns a non-OK response.', 'The user is still signed in using session metadata (name falls back to email, role to blank) and an error is logged.',
    { kind: 'Negative', pre: 'GET /users/u1/role returns 404.', steps: '1. Mount the provider with a session and a 404 role lookup.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      mockFetch(() => json({ detail: 'nope' }, 404));
      const { result } = await mount();
      expect(result.current.user).toMatchObject({ name: 'a@x.com', role: '' });
      expect(console.error).toHaveBeenCalled();
    });

  tc('FE-AUTH-005', 'AuthProvider', 'Role lookup fails with a network error.', 'The user falls back to the metadata-derived profile and the app still loads.',
    { kind: 'Negative', pre: 'fetch rejects.', steps: '1. Mount the provider with a session and a rejecting fetch.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session({ user_metadata: { full_name: 'Full Name', role: 'venue staff' }, }) } });
      mockFetch(() => { throw new Error('offline'); });
      const { result } = await mount();
      expect(result.current.user).toMatchObject({ name: 'Full Name', role: 'venue staff' });
    });

  tc('FE-AUTH-006', 'login', 'User logs in with valid credentials.', 'signInWithPassword is called with the email and password and the signed-in user is returned.',
    { data: 'email = a@x.com; password = secret', steps: '1. Mount the provider. 2. Call login("a@x.com", "secret").' },
    async () => {
      auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
      const { result } = await mount();
      let user;
      await act(async () => { user = await result.current.login('a@x.com', 'secret'); });
      expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@x.com', password: 'secret' });
      expect(user.id).toBe('u1');
    });

  tc('FE-AUTH-007', 'login', 'Supabase rejects the credentials.', 'login rejects with an Error carrying Supabase\'s message.',
    { kind: 'Negative', data: 'error "Invalid login credentials"', steps: '1. Mock an auth error. 2. Call login(...).' },
    async () => {
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
      const { result } = await mount();
      await expect(result.current.login('a@x.com', 'bad')).rejects.toThrow('Invalid login credentials');
    });

  tc('FE-AUTH-008', 'logout', 'A signed-in user logs out.', 'signOut is called and user becomes null.',
    { pre: 'A user is signed in.', steps: '1. Mount with a session. 2. Call logout().' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      mockFetch(() => json({ name: 'Ann', role: 'x' }));
      const { result } = await mount();
      await act(async () => { await result.current.logout(); });
      expect(auth.signOut).toHaveBeenCalled();
      expect(result.current.user).toBeNull();
    });

  tc('FE-AUTH-009', 'logout', 'signOut fails.', 'The local user is cleared anyway and the error propagates.',
    { kind: 'Negative', pre: 'signOut rejects.', steps: '1. Mount with a session. 2. Make signOut reject. 3. Call logout().' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      mockFetch(() => json({ name: 'Ann', role: 'x' }));
      auth.signOut.mockRejectedValue(new Error('network'));
      const { result } = await mount();
      await act(async () => { await expect(result.current.logout()).rejects.toThrow('network'); });
      expect(result.current.user).toBeNull();
    });

  tc('FE-AUTH-010', 'AuthProvider', 'Supabase reports a sign-in event after mount.', 'user is updated from the new session and its profile.',
    { steps: '1. Mount with no session. 2. Trigger the auth-state listener with a session.' },
    async () => {
      mockFetch(() => json({ name: 'Ann', role: 'Venue Staff' }));
      const { result } = await mount();
      await act(async () => { authListener('SIGNED_IN', session()); });
      await waitFor(() => expect(result.current.user?.role).toBe('Venue Staff'));
    });

  tc('FE-AUTH-011', 'AuthProvider', 'Supabase reports sign-out after mount.', 'user is set back to null.',
    { steps: '1. Mount with a session. 2. Trigger the listener with a null session.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      mockFetch(() => json({ name: 'Ann', role: 'x' }));
      const { result } = await mount();
      await act(async () => { authListener('SIGNED_OUT', null); });
      await waitFor(() => expect(result.current.user).toBeNull());
    });

  tc('FE-AUTH-012', 'AuthProvider', 'The provider unmounts.', 'The Supabase auth subscription is unsubscribed.',
    { steps: '1. Mount the provider. 2. Unmount it.' },
    async () => {
      const { unmount } = await mount();
      unmount();
      expect(auth.unsubscribe).toHaveBeenCalled();
    });
});
