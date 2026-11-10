import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../contexts/UsbConnectionContext', () => ({ useUsbConnection: () => ({ status: 'connected' }) }));
vi.mock('../../hooks/useRekordboxTracks', () => ({ useLibraryStats: () => ({ stats: { genreTotals: [{ name: 'Dance', count: 3 }] }, loading: false }) }));

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const group = readFileSync(new URL('./StreamingSyncGroup.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('./TrackSyncSelector.tsx', import.meta.url), 'utf8');

describe('Streaming group in the Library tab', () => {
  it('is shown in the Library tab of the profile page, after the library stats and the USBs (which hold the snapshots)', () => {
    const library = app.indexOf("settingsTab === 'library'");
    const at = app.indexOf('<StreamingSyncGroup');
    expect(at).toBeGreaterThan(library);
    expect(at).toBeGreaterThan(app.indexOf('<UsbCardsSection'));
    expect(at).toBeLessThan(app.indexOf('Danger zone'));
  });

  it('offers See Tracks with the sync switch off', async () => {
    const { StreamingSyncGroup } = await import('./StreamingSyncGroup');
    const markup = renderToStaticMarkup(createElement(StreamingSyncGroup, { userId: 'user', importId: 'i1', trackCount: 2283, sourceName: 'DJ STICK', deviceName: 'DJ STICK' }));
    expect(markup).toContain('Sync my music to the DropDex Cloud');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('See Tracks');
    expect(markup).not.toContain('streaming-sync-button');
    expect(group.indexOf('See Tracks')).toBeLessThan(group.indexOf('streaming-sync-button'));
  });

  it('confirms the selected Cloud copy with the standard destructive dialog', async () => {
    const { CloudTrackDeleteDialog } = await import('./CloudTracksGroup');
    const markup = renderToStaticMarkup(createElement(CloudTrackDeleteDialog, {
      inline: true, title: 'Track to remove', onClose: vi.fn(), onDelete: vi.fn(),
    }));
    expect(markup).toContain('dd-dialog--destructive');
    expect(markup).toContain('Delete Cloud copy?');
    expect(markup).toContain('Track to remove');
    expect(markup).toContain('Your original audio file and library record will stay in place.');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('>Delete</button>');
  });

  it('uses the same Cloud Sync dialog in Profile and Layout Lab', async () => {
    const { CloudSyncDialog } = await import('./CloudSyncDialog');
    const markup = renderToStaticMarkup(createElement(CloudSyncDialog, {
      inline: true, trackCount: 359, onClose: vi.fn(), onSelectTracks: vi.fn(), onSyncAll: vi.fn(),
    }));
    const lab = readFileSync(new URL('../ui/LayoutLabPopoverMockups.tsx', import.meta.url), 'utf8');
    expect(group).toContain('<CloudSyncDialog');
    expect(lab).toContain('<CloudSyncDialog inline trackCount={359}');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Sync your tracks to the Cloud');
    expect(markup).toContain('Sync all 359 tracks, or choose which ones to sync.');
    expect([...markup.matchAll(/>(Cancel|Select Tracks|Sync All)<\/button>/g)].map((match) => match[1]))
      .toEqual(['Cancel', 'Select Tracks', 'Sync All']);
  });

  it('Sync All switches to the progress dialog and shows the current job controls', async () => {
    const { CloudSyncProgressDialog } = await import('./CloudSyncProgressDialog');
    const { previewSyncStore } = await import('../../lib/preview/previewSync');
    const state = previewSyncStore.getState();
    const render = (updates: Partial<typeof state>) => renderToStaticMarkup(createElement(CloudSyncProgressDialog, {
      inline: true, sync: { ...state, ...updates }, onClose: vi.fn(), onStop: vi.fn(),
    }));

    expect(group).toContain('if (importId) start(importId)');
    expect(group).toContain('open={dialogOpen && hasSync}');
    expect(group).toContain('onStop={previewSyncStore.cancel}');
    const preparing = render({ phase: 'preparing' });
    expect(preparing).toContain('role="dialog"');
    expect(preparing).toContain('Getting ready…');
    expect(preparing).toContain('Run in Background');
    expect(preparing).toContain('>Stop</button>');

    const stopping = render({ phase: 'running', total: 4, processed: 1, stopping: true });
    expect(stopping).toMatch(/<button[^>]*disabled=""[^>]*>Stopping…<\/button>/);
    const stopped = render({ phase: 'done', total: 4, processed: 1, cancelled: true });
    expect(stopped).toContain('Sync stopped');
    expect(stopped).not.toContain('aria-valuenow="100"');
    expect(stopped).toContain('>Done</button>');
  });

  it('Select Tracks shows the track group, and its Sync button starts only the picked tracks', () => {
    const body = group.slice(group.indexOf('const selectTracks'), group.indexOf('return ('));
    expect(body).toContain('setSelecting(true)');
    expect(group).toContain('<TrackSyncSelector');
    expect(group).toContain('onSync={start}');
  });

  it('asks the user to connect a USB or use the desktop app instead of failing quietly', () => {
    expect(group).toContain('Connect your USB first');
    expect(group).toContain('Syncing needs the DropDex desktop app');
  });

  it('the track group has a filter row above the shared record listing with a checkbox for each track', async () => {
    const { TrackSyncSelector } = await import('./TrackSyncSelector');
    const markup = renderToStaticMarkup(createElement(TrackSyncSelector, { importId: 'i1', syncedKeys: new Set<string>(), onCancel: () => undefined, onSync: () => undefined }));
    expect(markup.indexOf('track-sync-filters')).toBeLessThan(markup.indexOf('Select all matching tracks'));
    for (const text of ['Search tracks', 'Genre', 'Status', 'role="checkbox"', 'Sync 0 Tracks']) expect(markup).toContain(text);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*data-testid="track-sync-submit"|data-testid="track-sync-submit"[^>]*disabled/);
    expect(selector).toContain('<RecordTrackListing');
    expect(selector).toContain('<CheckboxControl checked={selectedIds.has(track.id)}');
    expect(selector).toContain('Sync {selected.size.toLocaleString()} {selected.size === 1');
  });
});
