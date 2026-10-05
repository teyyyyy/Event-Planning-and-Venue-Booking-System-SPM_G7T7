import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const login = vi.hoisted(() => vi.fn());
vi.mock('../AuthContext', () => ({ useAuth: () => ({ login }) }));

import Login from '../Login';

const fill = (email, password) => {
  fireEvent.change(document.querySelector('input[type=email]'), { target: { value: email } });
  fireEvent.change(document.querySelector('input[type=password]'), { target: { value: password } });
};
const submit = () => fireEvent.click(screen.getByRole('button'));

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
});
