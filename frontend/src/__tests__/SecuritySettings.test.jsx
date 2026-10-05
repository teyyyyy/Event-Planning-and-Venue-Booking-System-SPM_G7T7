import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const auth = vi.hoisted(() => ({ value: {} }));
vi.mock('../AuthContext', () => ({ useAuth: () => auth.value }));

import SecurityButton from '../SecuritySettings';

const listDevices = vi.fn();
const startEnrollment = vi.fn();
const confirmDevice = vi.fn();
const removeDevice = vi.fn();
const phone = { id: 'a', name: 'Phone', createdAt: 't' };
const open = async () => { render(<SecurityButton />); fireEvent.click(screen.getByRole('button', { name: 'Security' })); await screen.findByRole('dialog'); };

describe('SecuritySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDevices.mockResolvedValue([phone]);
    auth.value = { listDevices, startEnrollment, confirmDevice, removeDevice };
  });

  tc('FE-SEC-001', 'SecurityButton', 'User opens Security from the sidebar.', 'The dialog lists their devices; with only one, Remove is disabled.',
    { steps: '1. Click Security.' },
    async () => {
      await open();
      expect(await screen.findByText('Phone')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    });

  tc('FE-SEC-002', 'SecurityButton', 'User adds a backup device.', 'Enrolment starts with the typed name, the QR code shows, and a valid code confirms the device and refreshes the list.',
    { data: 'name = Backup phone; code = 123456', steps: '1. Type a name, click Add. 2. Enter the code, click Confirm.' },
    async () => {
      startEnrollment.mockResolvedValue({ factorId: 'n', qrCode: 'data:image/svg+xml;qr', secret: 'KEY123' });
      confirmDevice.mockResolvedValue();
      await open();
      await screen.findByText('Phone');
      fireEvent.change(screen.getByPlaceholderText('e.g. Backup phone'), { target: { value: 'Backup phone' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add backup device' }));
      expect(await screen.findByAltText('Backup device setup QR code')).toBeInTheDocument();
      expect(startEnrollment).toHaveBeenCalledWith('Backup phone');
      listDevices.mockResolvedValue([phone, { id: 'n', name: 'Backup phone' }]);
      fireEvent.change(document.querySelector('input[autocomplete=one-time-code]'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm device' }));
      await waitFor(() => expect(confirmDevice).toHaveBeenCalledWith('n', '123456'));
      expect(await screen.findByText('Backup phone')).toBeInTheDocument();
    });

  tc('FE-SEC-003', 'SecurityButton', 'The new device\'s code is wrong.', 'The error is shown and the code box is cleared; setup stays open.',
    { kind: 'Negative', steps: '1. Start adding a device. 2. Enter a wrong code.' },
    async () => {
      startEnrollment.mockResolvedValue({ factorId: 'n', qrCode: 'q', secret: 'K' });
      confirmDevice.mockRejectedValue(new Error('Invalid TOTP code entered'));
      await open();
      await screen.findByText('Phone');
      fireEvent.change(screen.getByPlaceholderText('e.g. Backup phone'), { target: { value: 'B' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add backup device' }));
      await screen.findByAltText('Backup device setup QR code');
      fireEvent.change(document.querySelector('input[autocomplete=one-time-code]'), { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm device' }));
      expect(await screen.findByText('Invalid TOTP code entered')).toBeInTheDocument();
      expect(document.querySelector('input[autocomplete=one-time-code]').value).toBe('');
    });

  tc('FE-SEC-004', 'SecurityButton', 'User has two devices and removes one.', 'removeDevice is called for that device and the list reloads.',
    { steps: '1. Open Security with two devices. 2. Click Remove on the second.' },
    async () => {
      listDevices.mockResolvedValue([phone, { id: 'b', name: 'Tablet' }]);
      removeDevice.mockResolvedValue();
      await open();
      await screen.findByText('Tablet');
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
      await waitFor(() => expect(removeDevice).toHaveBeenCalledWith('b'));
      expect(listDevices).toHaveBeenCalledTimes(2);
    });

  tc('FE-SEC-005', 'SecurityButton', 'User closes the dialog.', 'The dialog disappears.',
    { steps: '1. Open Security. 2. Click Close.' },
    async () => {
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
});
