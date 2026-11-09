import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsbDeviceRecord } from '../../lib/queries/usbDevices';
import type { UsbSnapshot } from '../../lib/queries/usbLibraries';
import type { RekordboxTrack } from '../../types';
import { useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { UsbBrowseTab } from './UsbBrowseTab';
import { resolveUsbBrowseSelection, usbBrowseSnapshots } from './usbBrowseSelection';

const data = vi.hoisted(() => ({ tracks: {} as Record<string, RekordboxTrack[]>, more: '' }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../hooks/useRekordboxTracks', () => ({
  useLibraryTracks: vi.fn((importId: string) => ({ tracks: data.tracks[importId] ?? [], total: data.more === importId ? 501 : (data.tracks[importId]?.length ?? 0),
    loading: false, loadingMore: false, error: null, hasMore: data.more === importId, loadMore: vi.fn(), refresh: vi.fn() })),
  useLibraryStats: () => ({ stats: { genreTotals: [], artistTotals: [] }, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../hooks/useTrackRowCues', () => ({ useTrackRowCues: () => new Map() }));
vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({ useTrackPreviewWaveforms: () => ({ getState: (id: string) => ({ status: 'idle', trackId: id }), retry: vi.fn() }) }));
vi.mock('../../hooks/useTrackPlaylistCounts', () => ({ useTrackPlaylistCounts: () => ({ counts: new Map(), error: null, retry: vi.fn() }) }));
vi.mock('../ui/display/TrackListingWaveform', () => ({ TrackListingWaveform: () => null }));

const devices = ['REVERIE', 'LUMA', 'ARCHIVE'].map((label, index) => ({
  id: `usb-${index}`, deviceKey: `uuid:${index}`, label, nickname: null,
} as UsbDeviceRecord));
const snapshot = (importId: string, usbDeviceId: string, importedAt: string, isActive = false): UsbSnapshot => ({
  importId, usbDeviceId, importedAt, isActive, sourceFilename: 'exportLibrary.db', trackCount: 501, playlistCount: 2,
});
const snapshots = [
  snapshot('a-old', 'usb-0', '2020-01-01T00:00:00Z', true),
  snapshot('a-new', 'usb-0', '2026-11-06T00:00:00Z'),
  snapshot('b-new', 'usb-1', '2026-11-05T00:00:00Z'),
];
const render = (options: Partial<Parameters<typeof UsbBrowseTab>[0]> = {}) => renderToStaticMarkup(createElement(UsbBrowseTab, {
  devices, snapshots, loading: false, error: null, onRetry: vi.fn(), ...options,
}));

beforeEach(() => {
  vi.clearAllMocks(); data.more = '';
  data.tracks = {
    'a-new': [{ id: 'a-track', import_id: 'a-new', title: 'Reverie Track', artist: 'Artist A', date_added: '2026-10-25' } as RekordboxTrack],
    'b-new': [{ id: 'b-track', import_id: 'b-new', title: 'Luma Track', artist: 'Artist B', date_added: '2026-10-10' } as RekordboxTrack],
  };
});

describe('independent USB selections', () => {
  it('starts with two distinct USBs and handles zero or one saved USB', () => {
    expect(resolveUsbBrowseSelection(devices)).toEqual({ left: 'usb-0', right: 'usb-1' });
    expect(resolveUsbBrowseSelection([])).toEqual({ left: '', right: '' });
    expect(resolveUsbBrowseSelection(devices.slice(0, 1))).toEqual({ left: 'usb-0', right: '' });
  });

  it('preserves explicit selections after device reordering and resolves duplicate or removed choices', () => {
    expect(resolveUsbBrowseSelection([...devices].reverse(), { left: 'usb-0', right: 'usb-1' })).toEqual({ left: 'usb-0', right: 'usb-1' });
    expect(resolveUsbBrowseSelection(devices, { left: 'usb-1', right: 'usb-1' })).toEqual({ left: 'usb-1', right: 'usb-0' });
    expect(resolveUsbBrowseSelection(devices.slice(1), { left: 'usb-0', right: 'usb-1' })).toEqual({ left: 'usb-2', right: 'usb-1' });
  });

  it('offers only a USB’s own snapshots, newest first, without changing active-library flags', () => {
    expect(usbBrowseSnapshots(snapshots, 'usb-0').map(({ importId }) => importId)).toEqual(['a-new', 'a-old']);
    expect(usbBrowseSnapshots(snapshots, 'unknown')).toEqual([]);
    expect(snapshots.map(({ importId }) => importId)).toEqual(['a-old', 'a-new', 'b-new']);
    expect(snapshots[0].isActive).toBe(true);
    expect(snapshots[1].isActive).toBe(false);
  });
});

describe('read-only two-USB browser', () => {
  it('queries both selected snapshots independently, rather than showing the active import in both panels', () => {
    const markup = render();
    expect(markup).toContain('aria-label="USB A library"');
    expect(markup).toContain('aria-label="USB B library"');
    expect(markup).toContain('Reverie Track');
    expect(markup).toContain('Luma Track');
    expect(useLibraryTracks).toHaveBeenCalledWith('a-new', { search: '', genre: '', artist: '', debounceMs: 180 });
    expect(useLibraryTracks).toHaveBeenCalledWith('b-new', { search: '', genre: '', artist: '', debounceMs: 180 });
    expect(useLibraryTracks).not.toHaveBeenCalledWith('a-old', expect.anything());
    expect(markup).toContain('value="a-old"'); // The historical snapshot remains selectable.
    expect(markup).not.toContain('Make Active');
    expect(markup).not.toContain('Start transfer');
    expect(markup).not.toContain('aria-label="Play Reverie Track"');
  });

  it('provides separate search/filter/sort controls and no horizontal record scrolling', () => {
    const markup = render();
    expect(markup).toContain('aria-label="Search usb a tracks"');
    expect(markup).toContain('aria-label="Search usb b tracks"');
    expect(markup.match(/>Sort<\/p>/g)).toHaveLength(2);
    expect(markup.match(/>Order<\/p>/g)).toHaveLength(2);
    expect(markup).toContain('overflow-x:hidden');
    expect(markup.match(/usb-library-tracks/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="View all metadata for Luma Track"');
  });

  it('keeps tracks beyond the first page accessible through pagination', () => {
    data.more = 'a-new';
    const markup = render();
    expect(markup).toContain('1 of 501 matching tracks');
    expect(markup.match(/>Load more tracks<\/button>/g)).toHaveLength(1);
  });

  it('does not substitute another library when a USB has no imported snapshot', () => {
    const markup = render({ snapshots: snapshots.filter((item) => item.usbDeviceId === 'usb-0') });
    expect(markup).toContain('LUMA has no saved database snapshot');
    expect(markup).not.toContain('Luma Track');
    expect(useLibraryTracks).toHaveBeenCalledTimes(1);
  });

  it('explains missing USBs, loading and failures with a retry action', () => {
    expect(render({ devices: [], snapshots: [] })).toContain('No saved USBs yet');
    expect(render({ devices: devices.slice(0, 1) })).toContain('A second saved USB is needed');
    expect(render({ devices: [], snapshots: [], loading: true })).toContain('aria-label="Loading USB libraries"');
    expect(render({ devices: [], snapshots: [], error: 'Could not load USB libraries' })).toContain('Retry USB libraries');
  });
});
