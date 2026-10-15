import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const completePasswordReset = vi.hoisted(() => vi.fn());
const cancelPasswordReset = vi.hoisted(() => vi.fn());
vi.mock('../AuthContext', () => ({ useAuth: () => ({ completePasswordReset, cancelPasswordReset }) }));

import ResetPassword from '../ResetPassword';

const fill = (a, b) => {
  const [pw, confirm] = document.querySelectorAll('input[type=password]');
  fireEvent.change(pw, { target: { value: a } });
  fireEvent.change(confirm, { target: { value: b } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

describe('ResetPassword', () => {
  beforeEach(() => { completePasswordReset.mockReset(); cancelPasswordReset.mockReset(); });

  tc('FE-RESET-001', 'ResetPassword', 'User enters matching valid passwords.', 'completePasswordReset is called once with the new password.',
    { data: 'password = newpass123', steps: '1. Enter the password and confirmation. 2. Click "Reset password".' },
    async () => {
      completePasswordReset.mockResolvedValue();
      render(<ResetPassword />);
      fill('newpass123', 'newpass123');
      submit();
      await waitFor(() => expect(completePasswordReset).toHaveBeenCalledWith('newpass123'));
    });

  tc('FE-RESET-002', 'ResetPassword', 'The passwords do not match.', 'An error is shown and the password is not changed.',
    { kind: 'Negative', steps: '1. Enter different values. 2. Submit.' },
    () => {
      render(<ResetPassword />);
      fill('newpass123', 'different1');
      submit();
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
      expect(completePasswordReset).not.toHaveBeenCalled();
    });

  tc('FE-RESET-003', 'ResetPassword', 'The password is shorter than 8 characters.', 'An error is shown and the password is not changed.',
    { kind: 'Edge', data: 'password = short', steps: '1. Enter a 5-character password twice. 2. Submit.' },
    () => {
      render(<ResetPassword />);
      fill('short', 'short');
      submit();
      expect(screen.getByText(/at least 8 characters/)).toBeInTheDocument();
      expect(completePasswordReset).not.toHaveBeenCalled();
    });

  tc('FE-RESET-004', 'ResetPassword', 'The server rejects the new password.', 'The server message is shown and the form can be submitted again.',
    { kind: 'Negative', data: '"New password should be different"', steps: '1. Make completePasswordReset reject. 2. Submit.' },
    async () => {
      completePasswordReset.mockRejectedValue(new Error('New password should be different'));
      render(<ResetPassword />);
      fill('newpass123', 'newpass123');
      submit();
      expect(await screen.findByText('New password should be different')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled();
    });

  tc('FE-RESET-005', 'ResetPassword', 'User cancels.', 'cancelPasswordReset is called.',
    { steps: '1. Click "Cancel".' },
    () => {
      render(<ResetPassword />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(cancelPasswordReset).toHaveBeenCalled();
    });
});
