import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RekordboxImport, RekordboxTrack } from '../../types';
import { ImportLibraryView } from './ImportLibraryView';
import { ImportTrackMetadata } from './ImportTrackBrowser';
import { importMetadataFields, importMetadataValue, metadataValue } from './importMetadata';
import { useLibraryTracks } from '../../hooks/useRekordboxTracks';

const fixture = vi.hoisted(() => ({ tracks: [] as RekordboxTrack[], loading: false, error: null as string | null, hasMore: false }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../theme/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }) }));
vi.mock('../../hooks/useRekordboxTracks', () => ({
  useLibraryTracks: vi.fn(() => ({ ...fixture, total: fixture.hasMore ? 501 : fixture.tracks.length, loadingMore: false, loadMore: vi.fn(), refresh: vi.fn() })),
  useLibraryStats: () => ({ stats: { genreTotals: [{ name: 'House', count: 1 }], artistTotals: [{ name: 'Test Artist', count: 1 }] }, error: null, refresh: vi.fn() }),
}));
vi.mock('../../hooks/useTrackRowCues', () => ({ useTrackRowCues: () => new Map() }));
vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({ useTrackPreviewWaveforms: () => ({ getState: (id: string) => ({ status: 'idle', trackId: id }), retry: vi.fn() }) }));
vi.mock('../../hooks/useTrackPlaylistCounts', () => ({ useTrackPlaylistCounts: () => ({ counts: new Map(), error: null, retry: vi.fn() }) }));

const track = {
  id: 'track-1', import_id: 'snapshot-B', rekordbox_content_id: '42', title: 'Imported Track', artist: 'Test Artist',
  album: 'Original Album', bpm: 140, musical_key: '8A', genre: 'House', file_format: 'WAV', duration_ms: 120000,
  date_added: '2026-10-25', file_path: '/Music/Original.wav', comments: null,
  source_metadata: { bitRate: 320, sourceOnlyField: 'Retained source value', zero: 0, flag: false },
} as RekordboxTrack;
const snapshot = {
  id: 'snapshot-B', source_filename: 'exportLibrary.db', device_name: 'REVERIE', imported_at: '2026-11-06T00:00:00Z',
  track_count: 83, playlist_count: 1, status: 'completed', analysis_status: 'completed', library_ready_at: '2026-11-06T00:00:00Z',
} as RekordboxImport;
const render = (item = snapshot) => renderToStaticMarkup(createElement(ImportLibraryView, {
  item, isActive: true, onBack: vi.fn(), onResume: vi.fn(), onRetryImport: vi.fn(), onMakeActive: vi.fn(), onRetryDelete: vi.fn(),
}));

beforeEach(() => {
  fixture.tracks = [track]; fixture.loading = false; fixture.error = null; fixture.hasMore = false;
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('imported database browser', () => {
  it('shows the exact snapshot through the standard record listing and filter row on the shared graphite surface', () => {
    const markup = render();
    expect(markup).toContain('studio-surface cue-studio import-library-studio');
    expect(markup).not.toContain('class="glass');
    expect(useLibraryTracks).toHaveBeenLastCalledWith('snapshot-B', { search: '', genre: '', artist: '', debounceMs: 180 });
    expect(markup).toContain('aria-label="Search imported tracks"');
    for (const label of ['Genre', 'Artist', 'Metadata field']) expect(markup).toContain(`>${label}</p>`);
    expect(markup).toContain('aria-label="Imported database track records"');
    expect(markup).toContain('Imported Track');
    expect(markup).toContain('Original Album');
    expect(markup).toContain('2026-10-25');
    expect(markup).toContain('aria-label="View all metadata for Imported Track"');
    expect(markup).not.toContain('aria-label="Play Imported Track"');
    const headings = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
    for (const label of ['Track', 'Bpm', 'Key', 'Genre', 'Format', 'Playlists', 'Added On', 'Duration', 'Album', 'Actions']) {
      expect(headings).toContain(`>${label}<`);
    }
  });

  it('offers more records rather than silently limiting the snapshot to the first page', () => {
    fixture.hasMore = true;
    const markup = render();
    expect(markup).toContain('1 of 501 matching tracks');
    expect(markup).toContain('Load more tracks');
  });

  it('distinguishes loading, empty results and query failures', () => {
    fixture.tracks = []; fixture.loading = true;
    expect(render()).toContain('aria-label="Loading imported tracks"');
    fixture.loading = false;
    expect(render()).toContain('No track records match');
    fixture.error = 'Snapshot tracks could not be loaded';
    const failed = render();
    expect(failed).toContain(fixture.error);
    expect(failed).toContain('Retry tracks');
    expect(failed).not.toContain('No track records match');
  });

  it('preserves retry controls for a failed import', () => {
    expect(render({ ...snapshot, status: 'failed', analysis_status: 'failed', retryable: true, library_ready_at: null })).toContain('Retry Import');
  });
});

describe('all stored and retained source metadata', () => {
  it('makes normalized and source-only columns available without dropping zero or false values', () => {
    const fields = importMetadataFields([track, track]);
    expect(fields.filter(({ value }) => value === 'track:album')).toHaveLength(1);
    expect(fields).toContainEqual({ value: 'source:sourceOnlyField', label: 'Source: sourceOnlyField' });
    expect(importMetadataValue(track, 'track:album')).toBe('Original Album');
    expect(metadataValue(importMetadataValue(track, 'source:zero'))).toBe('0');
    expect(metadataValue(importMetadataValue(track, 'source:flag'))).toBe('false');
    expect(metadataValue(undefined)).toBe('—');
  });

  it('shows every imported field and the original source fields in the metadata inspector', () => {
    const markup = renderToStaticMarkup(createElement(ImportTrackMetadata, { track, onClose: vi.fn() }));
    expect(markup).toContain('/Music/Original.wav');
    expect(markup).toContain('Comments</dt><dd>—');
    expect(markup).toContain('sourceOnlyField');
    expect(markup).toContain('Retained source value');
    expect(markup).toContain('bitRate</dt><dd>320');
    expect(markup).not.toContain('were not retained');
  });

  it('explains when an older snapshot has no original source columns', () => {
    const markup = renderToStaticMarkup(createElement(ImportTrackMetadata, { track: { ...track, source_metadata: {} }, onClose: vi.fn() }));
    expect(markup).toContain('Original source columns were not retained');
    expect(markup).toContain('Original Album');
  });
});
