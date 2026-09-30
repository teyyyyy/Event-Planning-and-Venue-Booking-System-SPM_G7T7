import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const auth = vi.hoisted(() => ({ value: {} }));
vi.mock('../AuthContext', () => ({ useAuth: () => auth.value }));

import MfaChallenge from '../MfaChallenge';

const logout = vi.fn();
const startEnrollment = vi.fn();
const verifyMfa = vi.fn();
const codeInput = () => document.querySelector('input[autocomplete=one-time-code]');
const type = (code) => fireEvent.change(codeInput(), { target: { value: code } });

describe('MfaChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.value = { mfa: { step: 'verify', factorId: 'f1' }, logout, startEnrollment, verifyMfa };
  });

  tc('FE-MFA-001', 'MfaChallenge', 'A user with an authenticator is asked for a code.', 'The verification form shows; the button stays disabled until 6 digits are entered.',
    { steps: '1. Render with mfa step "verify". 2. Type 5 digits, then 6.' },
    () => {
      render(<MfaChallenge />);
      expect(screen.getByText('Two-factor verification')).toBeInTheDocument();
      expect(startEnrollment).not.toHaveBeenCalled();
      const button = screen.getByRole('button', { name: 'Verify' });
      type('12345');
      expect(button).toBeDisabled();
      type('123456');
      expect(button).toBeEnabled();
    });

  tc('FE-MFA-002', 'MfaChallenge', 'User types non-digit characters into the code box.', 'Only digits are kept.',
    { kind: 'Edge', data: '"12ab34"', steps: '1. Type "12ab34".' },
    () => { render(<MfaChallenge />); type('12ab34'); expect(codeInput().value).toBe('1234'); });

  tc('FE-MFA-003', 'MfaChallenge', 'User submits a correct code.', 'verifyMfa is called with the factor id and code.',
    { data: 'code = 123456', steps: '1. Type the code. 2. Click Verify.' },
    async () => {
      verifyMfa.mockResolvedValue();
      render(<MfaChallenge />);
      type('123456');
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await waitFor(() => expect(verifyMfa).toHaveBeenCalledWith('f1', '123456'));
    });

  tc('FE-MFA-004', 'MfaChallenge', 'User submits a wrong code.', 'The error is shown and the code box is cleared for another try.',
    { kind: 'Negative', steps: '1. Make verifyMfa reject. 2. Submit a code.' },
    async () => {
      verifyMfa.mockRejectedValue(new Error('Invalid TOTP code entered'));
      render(<MfaChallenge />);
      type('000000');
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByText('Invalid TOTP code entered')).toBeInTheDocument();
      expect(codeInput().value).toBe('');
    });

  tc('FE-MFA-005', 'MfaChallenge', 'A first-time user must set up an authenticator.', 'Setup starts automatically; the QR code and manual key are shown, and the factor from enrolment is the one verified.',
    { pre: 'mfa step "enroll".', steps: '1. Render. 2. Wait for enrolment. 3. Enter a code and submit.' },
    async () => {
      auth.value.mfa = { step: 'enroll' };
      startEnrollment.mockResolvedValue({ factorId: 'new', qrCode: 'data:image/svg+xml;qr', secret: 'ABCD1234' });
      verifyMfa.mockResolvedValue();
      render(<MfaChallenge />);
      expect(await screen.findByAltText('Authenticator setup QR code')).toHaveAttribute('src', 'data:image/svg+xml;qr');
      expect(screen.getByText('ABCD1234')).toBeInTheDocument();
      type('654321');
      fireEvent.click(screen.getByRole('button', { name: 'Enable and sign in' }));
      await waitFor(() => expect(verifyMfa).toHaveBeenCalledWith('new', '654321'));
    });

  tc('FE-MFA-006', 'MfaChallenge', 'Authenticator setup cannot be started.', 'The error is shown and submitting stays disabled.',
    { kind: 'Negative', steps: '1. Make startEnrollment reject. 2. Render in enroll mode.' },
    async () => {
      auth.value.mfa = { step: 'enroll' };
      startEnrollment.mockRejectedValue(new Error('MFA enroll is disabled'));
      render(<MfaChallenge />);
      expect(await screen.findByText('MFA enroll is disabled')).toBeInTheDocument();
      type('123456');
      expect(screen.getByRole('button', { name: 'Enable and sign in' })).toBeDisabled();
    });

  tc('FE-MFA-007', 'MfaChallenge', 'User chooses "Use a different account".', 'logout is called.',
    { steps: '1. Click the link.' },
    () => { render(<MfaChallenge />); fireEvent.click(screen.getByText('Use a different account')); expect(logout).toHaveBeenCalled(); });
});
