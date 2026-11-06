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

  const props = { groups, activeImportId: 'a', onOpen: vi.fn(), onMakeActive: vi.fn(), onResumeOrRetry: vi.fn(), onDelete: vi.fn() };

  it('shows every USB as a card, not only the primary one', async () => {
    const { UsbCardsSection } = await import('../../components/profile/UsbLibrarySections');
    const markup = renderToStaticMarkup(createElement(UsbCardsSection, props));
    expect(markup.match(/data-testid="usb-card"/g)).toHaveLength(3);
    for (const text of ['LUMA', 'Festival stick', 'EMPTY STICK', 'Active library', 'Connected now', '2,283 tracks · 4 playlists', 'No library imported from this USB yet.']) expect(markup).toContain(text);
  });

  it('puts each USB\'s exportLibrary.db snapshots inside that USB\'s own card', async () => {
    const { UsbCardsSection } = await import('../../components/profile/UsbLibrarySections');
    const markup = renderToStaticMarkup(createElement(UsbCardsSection, props));
    const cards = markup.split('data-testid="usb-card"').slice(1);
    const luma = cards.find((card) => card.includes('LUMA') && !card.includes('Festival stick'));
    const festival = cards.find((card) => card.includes('Festival stick'));
    const empty = cards.find((card) => card.includes('EMPTY STICK'));
    expect(luma).toContain('exportLibrary.db');
    expect(luma).not.toContain('second.db');
    expect(festival).toContain('second.db');
    expect(festival).toContain('1 import');
    expect(festival).toContain('data-testid="import-history-row-b"');
    // A USB with no snapshots has no snapshot list.
    expect(empty).not.toContain('usb-card-snapshots');
    // The snapshot's own actions come with it.
    expect(markup).toContain('Make Active');
    expect(markup).toContain('Delete');
  });

  it('keeps each USB card compact: the USB and its library summary share one line, and the rows are tight', async () => {
    const { UsbCardsSection } = await import('../../components/profile/UsbLibrarySections');
    const markup = renderToStaticMarkup(createElement(UsbCardsSection, props));
    expect(markup).toContain('px-4 py-2.5');
    expect(markup).toContain('data-testid="usb-card-summary"');
    // Name, badges and the summary sit in one row, not stacked blocks.
    const header = markup.slice(markup.indexOf('data-testid="usb-card"'), markup.indexOf('data-testid="usb-card-snapshots"'));
    expect(header).toContain('ml-auto');
    expect(header).not.toContain('flex-col gap-2 p-4');
    expect(header).not.toContain('Library snapshots ·');
    const row = readFileSync(resolve(__dirname, '../../components/profile/ImportSnapshotRow.tsx'), 'utf8');
    expect(row).toContain('px-4 py-2');
    expect(row).not.toContain('p-4 flex items-start');
  });

  it('has no separate Library Snapshots section any more', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).not.toContain('Library Snapshots by USB');
    expect(app).not.toContain('<UsbSnapshotGroups');
    expect(readFileSync(resolve(__dirname, '../../components/profile/UsbLibrarySections.tsx'), 'utf8')).not.toContain('export function UsbSnapshotGroups');
  });

  it('replaces the single-USB card, and is wired into the Library tab', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const tab = app.slice(app.indexOf("settingsTab === 'library'"), app.indexOf("settingsTab === 'about'"));
    expect(tab).toContain('<UsbCardsSection');
    expect(tab).toContain('groups={usbGroups}');
    expect(tab).not.toContain('{latestImport.device_name ?? latestImport.source_filename}');
    // The Library group starts with a USB card (the count of USBs) to the left of Tracks and Playlists.
    expect(tab).toContain('grid grid-cols-3 gap-3');
    expect(tab).toContain('data-testid="library-usb-count"');
    expect(tab.indexOf('library-usb-count')).toBeLessThan(tab.indexOf('>Tracks</p>'));
    expect(tab.indexOf('>Tracks</p>')).toBeLessThan(tab.indexOf('>Playlists</p>'));
    expect(app).toContain("group.key !== UNASSIGNED_KEY && !group.retired");
    expect(app).toContain('groupImportsByUsb(allImports, usbDevices, latestImport?.id ?? null)');
  });
});
