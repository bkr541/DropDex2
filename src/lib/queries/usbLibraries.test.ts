import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import { summarizeUsbLibraries, type UsbSnapshot } from './usbLibraries';

const snapshot = (over: Partial<UsbSnapshot>): UsbSnapshot => ({
  importId: 'i1', usbDeviceId: 'usb-1', sourceFilename: 'export.db', trackCount: 10, playlistCount: 2, importedAt: '2026-11-01T00:00:00Z', isActive: false, ...over,
});

describe('summarizeUsbLibraries', () => {
  it('gives each USB its own newest library, so two USBs never share tracks or playlists', () => {
    const result = summarizeUsbLibraries([
      snapshot({ importId: 'a-old', usbDeviceId: 'usb-1', importedAt: '2026-10-01T00:00:00Z' }),
      snapshot({ importId: 'a-new', usbDeviceId: 'usb-1', importedAt: '2026-11-01T00:00:00Z' }),
      snapshot({ importId: 'b', usbDeviceId: 'usb-2', trackCount: 99 }),
    ]);
    expect(result.get('usb-1')?.library.importId).toBe('a-new');
    expect(result.get('usb-1')?.snapshotCount).toBe(2);
    expect(result.get('usb-2')?.library.trackCount).toBe(99);
    expect(result.has('usb-3')).toBe(false);
  });

  it('shows the active library for a USB even when a newer import exists', () => {
    const result = summarizeUsbLibraries([
      snapshot({ importId: 'active', isActive: true, importedAt: '2026-10-01T00:00:00Z' }),
      snapshot({ importId: 'newer', importedAt: '2026-11-01T00:00:00Z' }),
    ]);
    expect(result.get('usb-1')).toMatchObject({ isActive: true, snapshotCount: 2, library: { importId: 'active' } });
  });

  it('marks a USB as not active when none of its snapshots is', () => {
    expect(summarizeUsbLibraries([snapshot({})]).get('usb-1')?.isActive).toBe(false);
  });
});
