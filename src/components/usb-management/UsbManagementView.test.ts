import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUsbDetails } from '../../types/dropdex-desktop';
import type { UsbDeviceRecord, UsbTransferRecord } from '../../lib/queries/usbDevices';
import { parseAppRoute, routeBackFallback, routeToUrl } from '../../navigation/appRoutes';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

const PRIMARY: DesktopUsbDetails = {
  volumeName: 'DJ STICK', connectedAt: '2026-11-03T12:00:00Z', totalBytes: 64_000_000_000, freeBytes: 24_000_000_000, usedBytes: 40_000_000_000,
  filesystem: 'exFAT', brand: 'SanDisk', model: 'Ultra Fit', protocol: 'USB', solidState: true, removable: true, volumeUuid: 'U1', deviceId: 'disk4s1',
};

const mocks = vi.hoisted(() => ({
  usb: { status: 'connected', volumeName: 'DJ STICK', error: null, structureWarning: null, selectNewUsb: vi.fn(), reconnect: vi.fn(), release: vi.fn() } as Record<string, unknown>,
  details: null as DesktopUsbDetails | null,
  destination: null as DesktopUsbDetails | null,
}));

vi.mock('../../contexts/UsbConnectionContext', () => ({ useUsbConnection: () => mocks.usb }));
vi.mock('../../hooks/useDesktopUsb', () => ({
  getDesktopBridge: () => ({}),
  usePrimaryUsbDetails: () => ({ details: mocks.details, loading: false, error: null, refresh: vi.fn() }),
  useTransferScan: () => ({ scan: { tracks: { fileCount: 120, totalBytes: 30_000_000_000 }, rekordbox: { fileCount: 80, totalBytes: 2_000_000_000 }, other: { fileCount: 3, totalBytes: 5_000_000 } }, loading: false }),
  useTransferDestination: () => ({ destination: mocks.destination, choosing: false, error: null, choose: vi.fn(), clear: vi.fn() }),
  useUsbTransfer: () => ({ state: { phase: 'idle' }, start: vi.fn(), cancel: vi.fn(), reset: vi.fn() }),
}));
vi.mock('../../hooks/useUsbLibrary', () => ({
  useUsbLibrary: () => ({ devices: [], transfers: [], loading: false, error: null, refresh: vi.fn(), remember: vi.fn(), saveTransfer: vi.fn(), rename: vi.fn(), setRetired: vi.fn() }),
}));

beforeEach(() => {
  mocks.usb = { status: 'connected', volumeName: 'DJ STICK', error: null, structureWarning: null, selectNewUsb: vi.fn(), reconnect: vi.fn(), release: vi.fn() };
  mocks.details = PRIMARY;
  mocks.destination = null;
});

describe('USB Management page', () => {
  it('opens on My USB with four tabs', async () => {
    const { UsbManagementView } = await import('./UsbManagementView');
    const markup = renderToStaticMarkup(createElement(UsbManagementView));
    expect(markup).toContain('data-testid="usb-management-view"');
    for (const label of ['My USB', 'Transfer', 'History', 'My USBs']) expect(markup).toContain(label);
  });

  it('shows the primary USB: name, make and model, size, free space and format', async () => {
    const { UsbOverviewTab } = await import('./UsbOverviewTab');
    const markup = renderToStaticMarkup(createElement(UsbOverviewTab, { desktopAvailable: true }));
    for (const text of ['Primary USB', 'DJ STICK', 'SanDisk Ultra Fit', '64 GB', '24 GB', 'exFAT', 'SanDisk', 'Ultra Fit', 'Connected']) expect(markup).toContain(text);
    expect(markup).toContain('free of 64 GB');
    expect(markup).toContain('63% full');
  });

  it('asks the user to connect a USB when none is connected', async () => {
    mocks.usb = { ...mocks.usb, status: 'disconnected' };
    mocks.details = null;
    const { UsbOverviewTab } = await import('./UsbOverviewTab');
    const markup = renderToStaticMarkup(createElement(UsbOverviewTab, { desktopAvailable: true }));
    expect(markup).toContain('data-testid="usb-not-connected"');
    expect(markup).toContain('No USB connected');
    expect(markup).toContain('Choose your USB');
  });

  it('the Transfer tab shows the primary USB on the left and a clickable empty slot on the right', async () => {
    const { UsbTransferTab } = await import('./UsbTransferTab');
    const markup = renderToStaticMarkup(createElement(UsbTransferTab, { onFinished: async () => true, onShowHistory: () => undefined }));
    expect(markup).toContain('Copying from');
    expect(markup).toContain('DJ STICK');
    expect(markup).toContain('data-testid="usb-destination-empty"');
    expect(markup).toContain('Choose the USB to copy to');
    expect(markup.indexOf('Copying from')).toBeLessThan(markup.indexOf('usb-destination-empty'));
    expect(markup).toMatch(/<button[^>]*data-testid="usb-destination-empty"/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Start transfer|Start transfer[^]*disabled/);
  });

  it('shows the chosen second USB in the same style, and what each kind of data weighs', async () => {
    mocks.destination = { ...PRIMARY, volumeName: 'BACKUP', brand: 'Kingston', model: 'DataTraveler', freeBytes: 100_000_000_000, totalBytes: 128_000_000_000, usedBytes: 28_000_000_000, volumeUuid: 'U2' };
    const { UsbTransferTab } = await import('./UsbTransferTab');
    const markup = renderToStaticMarkup(createElement(UsbTransferTab, { onFinished: async () => true, onShowHistory: () => undefined }));
    const text = markup.replace(/<!-- -->/g, '');
    expect(markup).toContain('Copying to');
    expect(markup).toContain('BACKUP');
    expect(markup).not.toContain('usb-destination-empty');
    for (const label of ['Tracks', 'Rekordbox library', 'Other files', '120 files', '100 GB free on BACKUP', 'Nothing is deleted or replaced']) expect(text).toContain(label);
  });

  it('warns when the destination is too small', async () => {
    mocks.destination = { ...PRIMARY, volumeName: 'TINY', freeBytes: 1_000_000_000, totalBytes: 8_000_000_000, usedBytes: 7_000_000_000 };
    const { UsbTransferTab } = await import('./UsbTransferTab');
    const markup = renderToStaticMarkup(createElement(UsbTransferTab, { onFinished: async () => true, onShowHistory: () => undefined }));
    expect(markup).toContain('Not enough room');
  });
});

describe('USB history and My USBs', () => {
  const transfer: UsbTransferRecord = {
    id: 't1', sourceDeviceId: 'd1', destinationDeviceId: 'd2', sourceLabel: 'DJ STICK', destinationLabel: 'BACKUP', categories: ['tracks', 'rekordbox'],
    status: 'completed', copiedCount: 2, skippedCount: 0, failedCount: 0, totalBytes: 5_000_000, filesTruncated: false, error: null,
    files: [{ path: 'Contents/a.mp3', size: 4_000_000, status: 'copied' }, { path: 'PIONEER/rekordbox/export.pdb', size: 1_000_000, status: 'copied' }],
    startedAt: '2026-11-03T12:00:00Z', finishedAt: '2026-11-03T12:05:00Z',
  };

  it('lists each transfer from USB A to USB B', async () => {
    const { UsbHistoryTab } = await import('./UsbHistoryTab');
    const markup = renderToStaticMarkup(createElement(UsbHistoryTab, { transfers: [transfer], loading: false, error: null, onRetry: () => undefined }));
    for (const text of ['DJ STICK', 'BACKUP', 'Complete', 'Tracks and Rekordbox library', '2 files', '5 MB']) expect(markup).toContain(text);
  });

  it('has an empty state for no transfers, and a retry for a load failure', async () => {
    const { UsbHistoryTab } = await import('./UsbHistoryTab');
    expect(renderToStaticMarkup(createElement(UsbHistoryTab, { transfers: [], loading: false, error: null, onRetry: () => undefined }))).toContain('No transfers yet');
    const failed = renderToStaticMarkup(createElement(UsbHistoryTab, { transfers: [], loading: false, error: 'Could not load your USBs and transfer history.', onRetry: () => undefined }));
    expect(failed).toContain('Could not load');
    expect(failed).toContain('Try again');
  });

  const device = (over: Partial<UsbDeviceRecord>): UsbDeviceRecord => ({
    id: 'd1', deviceKey: 'uuid:u1', label: 'DJ STICK', nickname: null, brand: 'SanDisk', model: 'Ultra Fit', filesystem: 'exFAT', totalBytes: 64_000_000_000, freeBytes: 1,
    firstSeenAt: '2026-10-01T00:00:00Z', lastSeenAt: '2026-11-03T00:00:00Z', retiredAt: null, ...over,
  });

  it('keeps track of every USB, marks the connected one, and separates retired ones', async () => {
    const { UsbDevicesTab } = await import('./UsbDevicesTab');
    const markup = renderToStaticMarkup(createElement(UsbDevicesTab, {
      devices: [device({}), device({ id: 'd2', label: 'OLD ONE', nickname: 'Club stick', retiredAt: '2026-10-20T00:00:00Z' })],
      loading: false, error: null, connectedLabels: ['DJ STICK'], onRetry: () => undefined, onRename: async () => true, onSetRetired: async () => true,
      libraries: new Map(), onMakeLibraryActive: async () => true,
    }));
    for (const text of ['Your USBs · 1', 'DJ STICK', 'Connected now', 'SanDisk Ultra Fit · 64 GB · exFAT', 'No longer used · 1', 'Club stick', 'Retired', 'Rename', 'Use again']) expect(markup).toContain(text);
  });

  it('shows what each USB holds: its track and playlist counts, which is active, and a way to switch to it', async () => {
    const { UsbDevicesTab } = await import('./UsbDevicesTab');
    const snapshot = (importId: string, isActive: boolean) => ({ importId, usbDeviceId: 'd1', sourceFilename: 'export.db', trackCount: 2283, playlistCount: 14, importedAt: '2026-11-06T00:00:00Z', isActive });
    const props = { devices: [device({}), device({ id: 'd2', label: 'SECOND' })], loading: false, error: null, connectedLabels: [], onRetry: () => undefined, onRename: async () => true, onSetRetired: async () => true, onMakeLibraryActive: async () => true };
    const active = renderToStaticMarkup(createElement(UsbDevicesTab, { ...props, libraries: new Map([['d1', { usbDeviceId: 'd1', library: snapshot('i1', true), snapshotCount: 2, isActive: true }]]) }));
    expect(active).toContain('2,283 tracks · 14 playlists');
    expect(active).toContain('Active library');
    expect(active).toContain('2 imports of this USB');
    expect(active).toContain('Playlists');
    expect(active).not.toContain('Use this library');
    // The USB with no import says so.
    expect(active).toContain('No library imported from this USB yet.');
    const inactive = renderToStaticMarkup(createElement(UsbDevicesTab, { ...props, libraries: new Map([['d1', { usbDeviceId: 'd1', library: snapshot('i1', false), snapshotCount: 1, isActive: false }]]) }));
    expect(inactive).toContain('Use this library');
    expect(inactive).not.toContain('Active library');
  });

  it('explains how a USB gets added when there are none', async () => {
    const { UsbDevicesTab } = await import('./UsbDevicesTab');
    const markup = renderToStaticMarkup(createElement(UsbDevicesTab, { devices: [], loading: false, error: null, connectedLabels: [], onRetry: () => undefined, onRename: async () => true, onSetRetired: async () => true, libraries: new Map(), onMakeLibraryActive: async () => true }));
    expect(markup).toContain('No USBs yet');
  });
});

describe('routing and wiring', () => {
  it('has its own address, and Back returns to the library', () => {
    expect(parseAppRoute('/usb', '')).toEqual({ name: 'usb' });
    expect(routeToUrl({ name: 'usb' })).toBe('/usb');
    expect(routeBackFallback({ name: 'usb' })).toEqual({ name: 'library', tab: 'overview', search: '' });
  });

  it('appears in the left nav with its own page name header and is shown on its route', () => {
    expect(appSource).toContain("{ view: 'usb', icon: Usb, label: 'USB Management'");
    expect(appSource).toContain("case 'usb': return titledPage('USB Management');");
    expect(appSource).toContain("case 'usb': navigate({ name: 'usb' }); break;");
    expect(appSource).toContain("currentView === 'usb' && (");
    expect(appSource).toContain('<UsbManagementView />');
  });

  it('exposes the desktop bridge calls the page needs', () => {
    const preload = readFileSync(new URL('../../../electron/preload.cjs', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
    for (const channel of ['usb-details', 'transfer-destination', 'select-transfer-destination', 'clear-transfer-destination', 'scan-transfer', 'start-transfer', 'cancel-transfer', 'transfer-progress']) {
      expect(preload).toContain(`dropdex:${channel}`);
    }
    for (const channel of ['usb-details', 'select-transfer-destination', 'scan-transfer', 'start-transfer', 'cancel-transfer']) {
      expect(main).toContain(`'dropdex:${channel}'`);
    }
  });

  it('saves devices and transfers to tables that the migration creates, with row level security', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20261104010000_usb_devices_and_transfers.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.user_usb_devices');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.usb_transfers');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    const queries = readFileSync(new URL('../../lib/queries/usbDevices.ts', import.meta.url), 'utf8');
    expect(queries).toContain("from('user_usb_devices')");
    expect(queries).toContain("from('usb_transfers')");
  });
});
