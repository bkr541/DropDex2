import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecordTrackListing } from './RecordTrackListing';
import type { TrackTableSort } from './TrackTable';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../hooks/useTrackRowCues', () => ({ useTrackRowCues: () => new Map() }));
vi.mock('../../../hooks/useTrackPreviewWaveforms', () => ({ useTrackPreviewWaveforms: () => ({ getState: (id: string) => ({ status: 'idle', trackId: id }), retry: vi.fn() }) }));
vi.mock('../../../hooks/useTrackPlaylistCounts', () => ({ useTrackPlaylistCounts: () => ({ counts: new Map(), error: null, retry: vi.fn() }) }));
vi.mock('./TrackListingWaveform', () => ({ TrackListingWaveform: () => null }));

const tracks = [
  { id: 'fast', title: 'Fast Track', artist: 'Test Artist', bpm: 140, date_added: '2026-11-06', score: 10 },
  { id: 'slow', title: 'Slow Track', artist: 'Test Artist', bpm: 95, date_added: '2020-01-01', score: 2 },
];
const render = (sort?: TrackTableSort) => renderToStaticMarkup(createElement(RecordTrackListing<typeof tracks[number]>, {
  tracks, playback: false, renderLeading: () => null, ariaLabel: 'Test tracks',
  rowProps: (track) => ({ 'data-testid': `row-${track.id}` }),
  ...(sort ? { sort, onSort: vi.fn() } : {}),
}));

describe('RecordTrackListing sortable headers', () => {
  it('makes every data column sortable without requiring callers to supply a sort handler', () => {
    const markup = render();
    for (const label of ['Track', 'Bpm', 'Key', 'Genre', 'Format', 'Playlists', 'Added On', 'Duration']) {
      expect(markup).toContain(`aria-label="Sort by ${label}"`);
    }
    expect(markup).not.toContain('aria-label="Sort by Actions"');
    expect(markup.indexOf('data-testid="row-fast"')).toBeLessThan(markup.indexOf('data-testid="row-slow"'));
  });

  it('renders ascending and descending orders with the accessible active direction', () => {
    const asc = render({ column: 'bpm', direction: 'asc' });
    expect(asc.indexOf('data-testid="row-slow"')).toBeLessThan(asc.indexOf('data-testid="row-fast"'));
    expect(asc).toContain('aria-sort="ascending"');
    const desc = render({ column: 'bpm', direction: 'desc' });
    expect(desc.indexOf('data-testid="row-fast"')).toBeLessThan(desc.indexOf('data-testid="row-slow"'));
    expect(desc).toContain('aria-sort="descending"');
  });

  it('sorts workflow metadata from its raw value instead of the rendered label', () => {
    const markup = renderToStaticMarkup(createElement(RecordTrackListing<typeof tracks[number]>, {
      tracks, playback: false, renderLeading: () => null, ariaLabel: 'Test tracks',
      sort: { column: 'score', direction: 'asc' }, onSort: vi.fn(),
      rowProps: (track) => ({ 'data-testid': `row-${track.id}` }),
      additionalColumns: [{ id: 'score', label: 'Score', render: (track) => `${track.score} points`, sortValue: (track) => track.score }],
    }));
    expect(markup).toContain('aria-label="Sort by Score"');
    expect(markup.indexOf('data-testid="row-slow"')).toBeLessThan(markup.indexOf('data-testid="row-fast"'));
  });
});
