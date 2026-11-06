import { describe, expect, it, vi, beforeEach } from 'vitest';

const queries = vi.hoisted(() => ({
  rememberUsbDevice: vi.fn(),
  rememberUsbDeviceByName: vi.fn(),
}));
vi.mock('../queries/usbDevices', () => queries);
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolveImportUsbDeviceId } from './importUsbDevice';
import { buildPlaylistIdentityKey, playlistKeyOwner } from '../queries/userPlaylists';
import { deviceKeyFor, nameOnlyDeviceKey } from './usbFormat';

vi.mock('../supabase', () => ({ supabase: {} }));

const details = (over: Record<string, unknown> = {}) => ({ volumeName: 'LUMA', volumeUuid: 'ABC-123', totalBytes: 64e9, ...over });

beforeEach(() => {
  queries.rememberUsbDevice.mockReset().mockResolvedValue({ id: 'usb-desktop' });
  queries.rememberUsbDeviceByName.mockReset().mockResolvedValue({ id: 'usb-by-name' });
});

describe('resolveImportUsbDeviceId', () => {
  it('uses the connected drive\'s own details in the desktop app, so same-named USBs stay separate', async () => {
    const bridge = { getUsbDetails: vi.fn().mockResolvedValue(details()) };
    expect(await resolveImportUsbDeviceId('u1', 'LUMA', bridge as never)).toBe('usb-desktop');
    expect(queries.rememberUsbDevice).toHaveBeenCalledWith('u1', expect.objectContaining({ volumeUuid: 'ABC-123' }));
    expect(queries.rememberUsbDeviceByName).not.toHaveBeenCalled();
  });

  it('does not trust the connected drive when it is not the folder being imported', async () => {
    const bridge = { getUsbDetails: vi.fn().mockResolvedValue(details({ volumeName: 'OTHER' })) };
    expect(await resolveImportUsbDeviceId('u1', 'LUMA', bridge as never)).toBe('usb-by-name');
    expect(queries.rememberUsbDevice).not.toHaveBeenCalled();
  });

  it('uses the drive name in the browser build, where the hardware id cannot be read', async () => {
    expect(await resolveImportUsbDeviceId('u1', 'LUMA', null)).toBe('usb-by-name');
    expect(queries.rememberUsbDeviceByName).toHaveBeenCalledWith('u1', 'LUMA');
  });

  it('falls back to the name when the desktop details cannot be read', async () => {
    const bridge = { getUsbDetails: vi.fn().mockRejectedValue(new Error('no usb')) };
    expect(await resolveImportUsbDeviceId('u1', 'LUMA', bridge as never)).toBe('usb-by-name');
  });

  it('returns null, and never throws, when there is no drive name or saving fails', async () => {
    expect(await resolveImportUsbDeviceId('u1', undefined, null)).toBeNull();
    expect(await resolveImportUsbDeviceId('u1', '  ', null)).toBeNull();
    queries.rememberUsbDeviceByName.mockRejectedValue(new Error('offline'));
    expect(await resolveImportUsbDeviceId('u1', 'LUMA', null)).toBeNull();
  });
});

describe('USB ids in playlist keys', () => {
  it('keys playlist customisations by the USB id, so two USBs with one name never collide', () => {
    expect(playlistKeyOwner({ usb_device_id: 'usb-1', device_name: 'LUMA' })).toBe('usb-1');
    expect(playlistKeyOwner({ usb_device_id: 'usb-2', device_name: 'LUMA' })).toBe('usb-2');
    expect(buildPlaylistIdentityKey('usb-1', '42')).not.toBe(buildPlaylistIdentityKey('usb-2', '42'));
  });

  it('falls back to the drive name only for snapshots that have no USB id', () => {
    expect(playlistKeyOwner({ usb_device_id: null, device_name: 'LUMA' })).toBe('LUMA');
    expect(playlistKeyOwner({ device_name: null })).toBe('');
  });
});

describe('device keys', () => {
  it('a drive known only by name has the same key the migration gave it, so the desktop app can claim it', () => {
    expect(nameOnlyDeviceKey(' LUMA ')).toBe('name:luma|unknown');
    expect(deviceKeyFor({ volumeUuid: null, volumeName: 'LUMA', totalBytes: null })).toBe('name:luma|unknown');
    expect(deviceKeyFor({ volumeUuid: 'AB-1', volumeName: 'LUMA', totalBytes: 1 })).toBe('uuid:ab-1');
  });
});
