import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RekordboxImport } from '../../types';
import type { UsbDeviceRecord } from '../queries/usbDevices';

vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../../contexts/UsbConnectionContext', () => ({ useUsbConnection: () => ({ volumeName: 'LUMA' }) }));

import { groupImportsByUsb, UNASSIGNED_KEY } from './groupImportsByUsb';

const device = (over: Partial<UsbDeviceRecord>): UsbDeviceRecord => ({
  id: 'd1', deviceKey: 'uuid:1', label: 'LUMA', nickname: null, brand: null, model: null, filesystem: null, totalBytes: null, freeBytes: null,
  firstSeenAt: '2026-10-01T00:00:00Z', lastSeenAt: '2026-11-01T00:00:00Z', retiredAt: null, ...over,
});

const snap = (over: Partial<RekordboxImport>): RekordboxImport => ({
  id: 'i1', user_id: 'u', source_filename: 'exportLibrary.db', source_type: 'onelibrary', database_version: null, device_name: 'LUMA', usb_device_id: 'd1',
  rekordbox_created_date: null, track_count: 100, playlist_count: 4, playlist_track_count: 0, status: 'completed', library_ready_at: '2026-11-01T00:00:00Z',
  imported_at: '2026-11-01T00:00:00Z', ...over,
} as RekordboxImport);

describe('groupImportsByUsb', () => {
  it('groups exportLibrary.db snapshots under the USB they came from, using its id, even when two USBs share a name', () => {
    const groups = groupImportsByUsb(
      [snap({ id: 'a', usb_device_id: 'd1' }), snap({ id: 'b', usb_device_id: 'd2', device_name: 'LUMA' }), snap({ id: 'c', usb_device_id: 'd1', imported_at: '2026-11-03T00:00:00Z' })],
      [device({ id: 'd1' }), device({ id: 'd2', deviceKey: 'uuid:2' })],
      null,
    );
    expect(groups.find((group) => group.key === 'd1')?.imports.map((item) => item.id)).toEqual(['c', 'a']);
    expect(groups.find((group) => group.key === 'd2')?.imports.map((item) => item.id)).toEqual(['b']);
  });

  it('uses the nickname when there is one, and gives every saved USB a group, even one with no imports', () => {
    const groups = groupImportsByUsb([], [device({ id: 'd1', nickname: 'Club stick' })], null);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: 'Club stick', imports: [], library: null });
  });

  it('stands for each USB with its active library, otherwise its newest usable one', () => {
    const imports = [
      snap({ id: 'old', imported_at: '2026-10-01T00:00:00Z' }),
      snap({ id: 'new', imported_at: '2026-11-02T00:00:00Z' }),
      snap({ id: 'half', imported_at: '2026-11-04T00:00:00Z', library_ready_at: null, status: 'processing' }),
    ];
    expect(groupImportsByUsb(imports, [device({})], null)[0].library?.id).toBe('new');
    const active = groupImportsByUsb(imports, [device({})], 'old')[0];
    expect(active).toMatchObject({ hasActive: true });
    expect(active.library?.id).toBe('old');
  });

  it('puts the USB with the active library first, then USBs with libraries, then ones with none, then other imports, then retired', () => {
    const groups = groupImportsByUsb(
      [snap({ id: 'a', usb_device_id: 'd2', imported_at: '2026-11-05T00:00:00Z' }), snap({ id: 'b', usb_device_id: 'd1' }), snap({ id: 'c', usb_device_id: null, device_name: null }), snap({ id: 'r', usb_device_id: 'd5' })],
      [device({ id: 'd1', label: 'ACTIVE ONE' }), device({ id: 'd2', label: 'NEWER' }), device({ id: 'd3', label: 'EMPTY' }), device({ id: 'd5', label: 'OLD', retiredAt: '2026-10-20T00:00:00Z' })],
      'b',
    );
    expect(groups.map((group) => group.name)).toEqual(['ACTIVE ONE', 'NEWER', 'EMPTY', 'Other imports', 'OLD']);
    expect(groups[3].key).toBe(UNASSIGNED_KEY);
  });

  it('still groups snapshots when the USB list did not load, named from the drive name they were saved with', () => {
    const groups = groupImportsByUsb([snap({ usb_device_id: 'd9', device_name: 'FALLBACK' })], [], null);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'd9', name: 'FALLBACK' });
  });
});

describe('Library tab in the profile', () => {
  const groups = groupImportsByUsb(
    [snap({ id: 'a', usb_device_id: 'd1' }), snap({ id: 'b', usb_device_id: 'd2', source_filename: 'second.db', track_count: 2283 })],
    [device({ id: 'd1' }), device({ id: 'd2', label: 'SECOND', nickname: 'Festival stick' }), device({ id: 'd3', label: 'EMPTY STICK' })],
    'a',
  );

  it('shows every USB as a card, not only the primary one', async () => {
    const { UsbCardsSection } = await import('../../components/profile/UsbLibrarySections');
    const markup = renderToStaticMarkup(createElement(UsbCardsSection, { groups }));
    expect(markup.match(/data-testid="usb-card"/g)).toHaveLength(3);
    for (const text of ['LUMA', 'Festival stick', 'EMPTY STICK', 'Active library', 'Connected now', '2,283 tracks · 4 playlists'.replace('4', '4'), 'No library imported from this USB yet.']) expect(markup).toContain(text);
  });

  it('groups the exportLibrary.db snapshots under each USB, and leaves out USBs with no snapshots', async () => {
    const { UsbSnapshotGroups } = await import('../../components/profile/UsbLibrarySections');
    const markup = renderToStaticMarkup(createElement(UsbSnapshotGroups, { groups, activeImportId: 'a', onOpen: vi.fn(), onMakeActive: vi.fn(), onResumeOrRetry: vi.fn(), onDelete: vi.fn() }));
    expect(markup.match(/data-testid="usb-snapshot-group"/g)).toHaveLength(2);
    expect(markup).toContain('exportLibrary.db');
    expect(markup).toContain('second.db');
    expect(markup.indexOf('Festival stick')).toBeGreaterThan(markup.indexOf('exportLibrary.db'));
    expect(markup).not.toContain('EMPTY STICK');
    expect(markup).toContain('data-testid="import-history-row-a"');
    expect(markup).toContain('Make Active');
  });

  it('replaces the single-USB card, and is wired into the Library tab', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const tab = app.slice(app.indexOf("settingsTab === 'library'"), app.indexOf("settingsTab === 'about'"));
    expect(tab).toContain('<UsbCardsSection groups={usbGroups} />');
    expect(tab).toContain('<UsbSnapshotGroups');
    expect(tab).not.toContain('{latestImport.device_name ?? latestImport.source_filename}');
    expect(tab).toContain('grid grid-cols-2 gap-3');
    expect(tab.indexOf('<UsbCardsSection')).toBeLessThan(tab.indexOf('<UsbSnapshotGroups'));
    expect(app).toContain('groupImportsByUsb(allImports, usbDevices, latestImport?.id ?? null)');
  });
});
