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

  it('starts with the switch off and no sync button', async () => {
    const { StreamingSyncGroup } = await import('./StreamingSyncGroup');
    const markup = renderToStaticMarkup(createElement(StreamingSyncGroup, { importId: 'i1', trackCount: 2283, sourceName: 'DJ STICK', deviceName: 'DJ STICK' }));
    expect(markup).toContain('Sync my music to the DropDex cloud');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).not.toContain('streaming-sync-button');
  });

  it('opens a dialog with Cancel, Select Tracks and Sync All, in that order', () => {
    const labels = [...group.matchAll(/\{ label: '([^']+)', variant/g)].map((m) => m[1]);
    expect(labels).toEqual(['Cancel', 'Select Tracks', 'Sync All']);
    expect(group).toContain("import { Dialog, QuietProgress, quietOverallPercent, type QuietPhase } from '../ui/feedback';");
  });

  it('Sync All closes the dialog and starts the sync with every track in the library', () => {
    const body = group.slice(group.indexOf('const syncAll'), group.indexOf('const selectTracks'));
    expect(body.indexOf('setDialogOpen(false)')).toBeLessThan(body.indexOf('fetchAllImportTracks'));
    expect(body).toContain('start(await fetchAllImportTracks(importId))');
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
