import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch } from '../test/helpers';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), unsubscribe: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn(), listFactors: vi.fn(), enroll: vi.fn(), unenroll: vi.fn(), challengeAndVerify: vi.fn() },
}));
vi.mock('../utils/supabase', () => ({ supabase: { auth } }));

import { AuthProvider, useAuth } from '../AuthContext';

const session = (extra = {}) => ({ access_token: 'token-1', user: { id: 'u1', email: 'a@x.com', user_metadata: {}, ...extra } });
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
let authListener;

describe('AuthContext', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.onAuthStateChange.mockImplementation((cb) => { authListener = cb; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; });
    auth.signOut.mockResolvedValue({});
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } });
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] } });
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
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-1');
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

  tc('FE-AUTH-005', 'AuthProvider', 'Role lookup fails with a network error.', 'The user remains signed in, but the role is blank and no role workspace is granted.',
    { kind: 'Negative', pre: 'fetch rejects.', steps: '1. Mount the provider with a session and a rejecting fetch.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session({ user_metadata: { full_name: 'Full Name', role: 'venue staff' }, }) } });
      mockFetch(() => { throw new Error('offline'); });
      const { result } = await mount();
      expect(result.current.user).toMatchObject({ name: 'Full Name', role: '' });
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

  tc('FE-AUTH-013', 'AuthProvider (MFA)', 'A password-only session exists and the user has a verified authenticator.', 'No user is exposed and mfa asks for a code for that factor; the backend is not called.',
    { kind: 'Security', pre: 'Session is aal1; one verified TOTP factor f1.', steps: '1. Mount the provider with an aal1 session.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } });
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }], all: [{ id: 'f1', status: 'verified' }] } });
      const fetchMock = mockFetch(() => json({}));
      const { result } = await mount();
      expect(result.current.user).toBeNull();
      expect(result.current.mfa).toEqual({ step: 'verify', factorId: 'f1' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

  tc('FE-AUTH-014', 'AuthProvider (MFA)', 'A password-only session exists and the user has no authenticator yet.', 'No user is exposed and mfa asks the user to enrol.',
    { kind: 'Security', pre: 'Session is aal1; no TOTP factors.', steps: '1. Mount the provider with an aal1 session.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } });
      const { result } = await mount();
      expect(result.current.user).toBeNull();
      expect(result.current.mfa).toEqual({ step: 'enroll' });
    });

  tc('FE-AUTH-015', 'verifyMfa', 'User enters a correct code for their authenticator.', 'The code is checked against the factor, the session is re-read at aal2 and the user is signed in.',
    { pre: 'Session is aal1 with factor f1.', data: 'code = " 123456 "', steps: '1. Mount with an aal1 session. 2. Upgrade the session to aal2. 3. Call verifyMfa("f1", " 123456 ").' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' } });
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }], all: [] } });
      mockFetch(() => json({ name: 'Ann', role: 'Venue Staff' }));
      auth.mfa.challengeAndVerify.mockResolvedValue({ error: null });
      const { result } = await mount();
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' } });
      await act(async () => { await result.current.verifyMfa('f1', ' 123456 '); });
      expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
      expect(result.current.user?.role).toBe('Venue Staff');
      expect(result.current.mfa).toBeNull();
    });

  tc('FE-AUTH-016', 'verifyMfa', 'User enters a wrong code.', 'verifyMfa rejects with Supabase\'s message and the user stays signed out.',
    { kind: 'Negative', pre: 'Session is aal1 with factor f1.', steps: '1. Make challengeAndVerify return an error. 2. Call verifyMfa.' },
    async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() } });
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' } });
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }], all: [] } });
      auth.mfa.challengeAndVerify.mockResolvedValue({ error: { message: 'Invalid TOTP code entered' } });
      const { result } = await mount();
      await act(async () => { await expect(result.current.verifyMfa('f1', '000000')).rejects.toThrow('Invalid TOTP code entered'); });
      expect(result.current.user).toBeNull();
    });

  tc('FE-AUTH-017', 'startEnrollment', 'A user starts authenticator setup and has a half-finished earlier attempt.', 'The stale unverified factor is removed and the new factor\'s id, QR code and secret are returned.',
    { pre: 'listFactors reports an unverified factor "old".', steps: '1. Call startEnrollment().' },
    async () => {
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: 'old', status: 'unverified' }, { id: 'keep', status: 'verified' }] } });
      auth.mfa.unenroll.mockResolvedValue({});
      auth.mfa.enroll.mockResolvedValue({ data: { id: 'new', totp: { qr_code: 'data:image/svg+xml;qr', secret: 'ABCD' } }, error: null });
      const { result } = await mount();
      let enrollment;
      await act(async () => { enrollment = await result.current.startEnrollment(); });
      expect(auth.mfa.unenroll).toHaveBeenCalledTimes(1);
      expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });
      expect(enrollment).toEqual({ factorId: 'new', qrCode: 'data:image/svg+xml;qr', secret: 'ABCD' });
    });

  tc('FE-AUTH-018', 'startEnrollment', 'Supabase refuses to start enrolment.', 'startEnrollment rejects with Supabase\'s message.',
    { kind: 'Negative', steps: '1. Make enroll return an error. 2. Call startEnrollment().' },
    async () => {
      auth.mfa.enroll.mockResolvedValue({ data: null, error: { message: 'MFA enroll is disabled' } });
      const { result } = await mount();
      await act(async () => { await expect(result.current.startEnrollment()).rejects.toThrow('MFA enroll is disabled'); });
    });

  tc('FE-AUTH-019', 'listDevices', 'A signed-in user opens their security settings.', 'Their verified authenticators are returned with a display name and creation date.',
    { steps: '1. Mock two verified factors. 2. Call listDevices().' },
    async () => {
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'a', friendly_name: 'Phone', created_at: 't1' }, { id: 'b', created_at: 't2' }], all: [] } });
      const { result } = await mount();
      let devices;
      await act(async () => { devices = await result.current.listDevices(); });
      expect(devices).toEqual([{ id: 'a', name: 'Phone', createdAt: 't1' }, { id: 'b', name: 'Authenticator', createdAt: 't2' }]);
    });

  tc('FE-AUTH-020', 'removeDevice', 'User removes one of two authenticators.', 'The chosen factor is unenrolled.',
    { pre: 'Two verified factors.', steps: '1. Call removeDevice("b").' },
    async () => {
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'a' }, { id: 'b' }], all: [] } });
      auth.mfa.unenroll.mockResolvedValue({ error: null });
      const { result } = await mount();
      await act(async () => { await result.current.removeDevice('b'); });
      expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'b' });
    });

  tc('FE-AUTH-021', 'removeDevice', 'User tries to remove their only authenticator.', 'It is refused with a message and nothing is unenrolled.',
    { kind: 'Security', pre: 'One verified factor.', steps: '1. Call removeDevice("a").' },
    async () => {
      auth.mfa.unenroll.mockClear();
      auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'a' }], all: [] } });
      const { result } = await mount();
      await act(async () => { await expect(result.current.removeDevice('a')).rejects.toThrow('at least one authenticator'); });
      expect(auth.mfa.unenroll).not.toHaveBeenCalled();
    });

  tc('FE-AUTH-022', 'confirmDevice', 'User confirms a new backup device with its code.', 'The code is verified for that factor; a wrong code rejects with Supabase\'s message.',
    { steps: '1. Call confirmDevice("n", " 123456 "). 2. Repeat with an error response.' },
    async () => {
      auth.mfa.challengeAndVerify.mockResolvedValueOnce({ error: null });
      const { result } = await mount();
      await act(async () => { await result.current.confirmDevice('n', ' 123456 '); });
      expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'n', code: '123456' });
      auth.mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: 'Invalid TOTP code entered' } });
      await act(async () => { await expect(result.current.confirmDevice('n', '000000')).rejects.toThrow('Invalid TOTP code entered'); });
    });

  tc('FE-AUTH-023', 'AuthProvider', 'requestPasswordReset is called with an email.', 'Supabase is asked to email a recovery link redirecting to the app origin.',
    { data: 'email = " a@x.com "', steps: '1. Mount. 2. Call requestPasswordReset.' },
    async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const { result } = await mount();
      await act(() => result.current.requestPasswordReset(' a@x.com '));
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@x.com', { redirectTo: window.location.origin });
    });

  tc('FE-AUTH-024', 'AuthProvider', 'Supabase rejects the recovery request.', 'requestPasswordReset throws the error message.',
    { kind: 'Negative', steps: '1. Make resetPasswordForEmail return an error. 2. Call requestPasswordReset.' },
    async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'Rate limit' } });
      const { result } = await mount();
      await expect(result.current.requestPasswordReset('a@x.com')).rejects.toThrow('Rate limit');
    });

  tc('FE-AUTH-025', 'AuthProvider', 'The recovery link is opened.', 'recovery is true and no user is signed in, even though a session exists.',
    { kind: 'State', steps: '1. Mount. 2. Emit PASSWORD_RECOVERY with a session.' },
    async () => {
      const { result } = await mount();
      await act(async () => { authListener('PASSWORD_RECOVERY', session()); });
      expect(result.current.recovery).toBe(true);
      expect(result.current.user).toBeNull();
    });

  tc('FE-AUTH-026', 'AuthProvider', 'The new password is saved.', 'The password is updated, the session is signed out, recovery ends and a success notice is set.',
    { steps: '1. Enter recovery. 2. Call completePasswordReset.' },
    async () => {
      auth.updateUser.mockResolvedValue({ error: null });
      const { result } = await mount();
      await act(async () => { authListener('PASSWORD_RECOVERY', session()); });
      await act(() => result.current.completePasswordReset('newpass123'));
      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
      expect(auth.signOut).toHaveBeenCalled();
      expect(result.current.recovery).toBe(false);
      expect(result.current.notice).toMatch(/password has been reset/);
    });

  tc('FE-AUTH-027', 'AuthProvider', 'Supabase rejects the new password.', 'completePasswordReset throws and the user stays in recovery.',
    { kind: 'Negative', steps: '1. Enter recovery. 2. Make updateUser fail. 3. Call completePasswordReset.' },
    async () => {
      auth.updateUser.mockResolvedValue({ error: { message: 'Weak password' } });
      const { result } = await mount();
      await act(async () => { authListener('PASSWORD_RECOVERY', session()); });
      await expect(result.current.completePasswordReset('x')).rejects.toThrow('Weak password');
      expect(result.current.recovery).toBe(true);
    });

  tc('FE-AUTH-028', 'AuthProvider', 'Other auth events arrive during recovery.', 'The recovery session is not turned into a signed-in user.',
    { kind: 'State', steps: '1. Enter recovery. 2. Emit SIGNED_IN with the same session.' },
    async () => {
      auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' } });
      mockFetch(() => json({ name: 'Ann', role: 'Attendee' }));
      const { result } = await mount();
      await act(async () => { authListener('PASSWORD_RECOVERY', session()); });
      await act(async () => { authListener('SIGNED_IN', session()); });
      expect(result.current.user).toBeNull();
    });
});
