import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const login = vi.hoisted(() => vi.fn());
const requestPasswordReset = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ notice: '' }));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ login, requestPasswordReset, notice: authState.notice }) }));

import Login from '../Login';

const fill = (email, password) => {
  fireEvent.change(document.querySelector('input[type=email]'), { target: { value: email } });
  fireEvent.change(document.querySelector('input[type=password]'), { target: { value: password } });
};
const submit = () => fireEvent.click(document.querySelector('button[type=submit]'));

describe('Login', () => {
  tc('FE-LOGIN-001', 'Login', 'The sign-in page renders.', 'Email and password inputs (both required) and an enabled "Sign in" button are shown; no error is displayed.',
    { steps: '1. Render <Login />.' },
    () => {
      render(<Login />);
      expect(document.querySelector('input[type=email]')).toBeRequired();
      expect(document.querySelector('input[type=password]')).toBeRequired();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
      expect(document.querySelector('.auth-error')).toBeNull();
    });

  tc('FE-LOGIN-002', 'Login', 'User enters credentials and submits.', 'login is called once with the entered email and password.',
    { data: 'email = a@x.com; password = secret', steps: '1. Type the email and password. 2. Click "Sign in".' },
    async () => {
      login.mockResolvedValue({});
      render(<Login />);
      fill('a@x.com', 'secret');
      submit();
      await waitFor(() => expect(login).toHaveBeenCalledWith('a@x.com', 'secret'));
      expect(login).toHaveBeenCalledTimes(1);
    });

  tc('FE-LOGIN-003', 'Login', 'Sign-in fails with a server message.', 'The message is shown and the button is usable again.',
    { kind: 'Negative', data: '"Invalid login credentials"', steps: '1. Make login reject. 2. Submit the form.' },
    async () => {
      login.mockRejectedValue(new Error('Invalid login credentials'));
      render(<Login />);
      fill('a@x.com', 'bad');
      submit();
      expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });

  tc('FE-LOGIN-004', 'Login', 'Sign-in fails with an error that has no message.', 'The fallback text "Unable to sign in" is shown.',
    { kind: 'Edge', steps: '1. Make login reject with an empty Error. 2. Submit.' },
    async () => {
      login.mockRejectedValue(new Error(''));
      render(<Login />);
      fill('a@x.com', 'x');
      submit();
      expect(await screen.findByText('Unable to sign in')).toBeInTheDocument();
    });

  tc('FE-LOGIN-005', 'Login', 'Sign-in is in progress.', 'The button is disabled and reads "Signing in…" until login settles.',
    { kind: 'State', pre: 'login returns a pending promise.', steps: '1. Submit the form. 2. Inspect the button. 3. Resolve login.' },
    async () => {
      let resolve;
      login.mockReturnValue(new Promise((r) => { resolve = r; }));
      render(<Login />);
      fill('a@x.com', 'x');
      submit();
      const busy = await screen.findByRole('button', { name: 'Signing in…' });
      expect(busy).toBeDisabled();
      resolve({});
      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
    });

  tc('FE-LOGIN-006', 'Login', 'A failed attempt is followed by a new submit.', 'The previous error is cleared while the new attempt runs.',
    { kind: 'State', steps: '1. Submit and fail. 2. Submit again with a pending login.' },
    async () => {
      login.mockRejectedValueOnce(new Error('Wrong password'));
      render(<Login />);
      fill('a@x.com', 'bad');
      submit();
      await screen.findByText('Wrong password');
      login.mockReturnValue(new Promise(() => {}));
      submit();
      await waitFor(() => expect(screen.queryByText('Wrong password')).not.toBeInTheDocument());
    });

  tc('FE-LOGIN-007', 'Login', 'User clicks "Forgot password?".', 'The reset form replaces the sign-in form, with no password field and a "Back to sign in" option.',
    { steps: '1. Render <Login />. 2. Click "Forgot password?".' },
    () => {
      render(<Login />);
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument();
      expect(document.querySelector('input[type=password]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });

  tc('FE-LOGIN-008', 'Login', 'User requests a recovery email.', 'requestPasswordReset is called with the email and a neutral confirmation is shown.',
    { data: 'email = a@x.com', steps: '1. Open the reset form. 2. Enter the email. 3. Click "Send recovery link".' },
    async () => {
      requestPasswordReset.mockResolvedValue();
      render(<Login />);
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      fireEvent.change(document.querySelector('input[type=email]'), { target: { value: 'a@x.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
      expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
      expect(requestPasswordReset).toHaveBeenCalledWith('a@x.com');
    });

  tc('FE-LOGIN-009', 'Login', 'The recovery email request fails.', 'The error message is shown and no confirmation appears.',
    { kind: 'Negative', steps: '1. Make requestPasswordReset reject. 2. Submit the reset form.' },
    async () => {
      requestPasswordReset.mockRejectedValue(new Error('Rate limit exceeded'));
      render(<Login />);
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      fireEvent.change(document.querySelector('input[type=email]'), { target: { value: 'a@x.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
      expect(await screen.findByText('Rate limit exceeded')).toBeInTheDocument();
      expect(screen.queryByText(/If an account exists/)).toBeNull();
    });

  tc('FE-LOGIN-010', 'Login', 'The user has just reset their password.', 'The success notice is shown on the sign-in form.',
    { kind: 'State', pre: 'AuthContext notice is set.', steps: '1. Render <Login />.' },
    () => {
      authState.notice = 'Your password has been reset. Sign in with your new password.';
      render(<Login />);
      expect(screen.getByText(/Your password has been reset/)).toBeInTheDocument();
      authState.notice = '';
    });
});
