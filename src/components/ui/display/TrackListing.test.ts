import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackListing, type TrackListingColumn } from './TrackListing';

interface Row { id: string; title: string; artist: string | null; bpm: number; status: 'ready' | 'warning' | 'error' | 'none' }
const rows: Row[] = [
  { id: 'a', title: 'First Track', artist: 'Artist A', bpm: 140, status: 'ready' },
  { id: 'b', title: 'Second Track', artist: null, bpm: 128, status: 'error' },
];
const columns: TrackListingColumn<Row>[] = [{ id: 'bpm', label: 'BPM', sort: 'bpm', render: (row) => row.bpm.toFixed(1) }];
const render = (props: Partial<Parameters<typeof TrackListing<Row>>[0]> = {}) => renderToStaticMarkup(createElement(TrackListing<Row>, {
  tracks: rows, columns, selectedId: 'a', getTitle: (r) => r.title, getArtist: (r) => r.artist, getStatus: (r) => r.status, ariaLabel: 'Tracks', ...props,
}));
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('TrackListing', () => {
  it('draws capital headings, the Track column first and an Actions column last', () => {
    const markup = render();
    const head = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
    expect(head.match(/<th /g)).toHaveLength(3);
    expect(head.indexOf('>Track<')).toBeLessThan(head.indexOf('>BPM<'));
    expect(head.indexOf('>BPM<')).toBeLessThan(head.indexOf('>Actions<'));
    expect(head).not.toContain('normal-case');
  });

  it('shows the original status dot, the title and the artist (or the app-wide missing-artist text) in every row', () => {
    const markup = render();
    expect(markup).toContain('bg-emerald-400');
    expect(markup).toContain('bg-red-400');
    expect(markup).toContain('First Track');
    expect(markup).toContain('Artist Not Available');
  });

  it('marks only the selected row, and sorts from the headings when asked', () => {
    expect(render().match(/cue-browser__row--selected/g)).toHaveLength(1);
    const sortable = render({ onSort: () => undefined, trackSort: 'title', sort: { column: 'bpm', direction: 'asc' } });
    expect(sortable).toContain('aria-label="Sort by Track"');
    expect(sortable).toContain('aria-label="Sort by BPM"');
    expect(render()).not.toContain('Sort by');
  });

  it('puts three dots in the Actions column unless told otherwise, and can rename the Track column', () => {
    expect(render().match(/aria-label="Actions for /g)).toHaveLength(2);
    expect(render({ actions: false })).not.toContain('Actions');
    expect(render({ actions: (row) => `custom ${row.id}` })).toContain('custom a');
    expect(render({ trackLabel: 'Candidate' })).toContain('>Candidate<');
  });

  it('is the second Waveform Preview mockup: capitals at 11px, a coral edge and a wash gone by 560px, floating dots', () => {
    const css = read('./track-listing.css');
    expect(css).toMatch(/thead \{[^}]*font-size: 11px;/);
    expect(css).toMatch(/cue-browser__row--selected, [^{]*\{[^}]*inset 4px 0 0 #f56b70[^}]*\}/);
    expect(css).toContain('#f56b7000 560px');
    expect(css).not.toMatch(/0 0 24px/);
    expect(css).toMatch(/\.track-listing__cue::before \{[^}]*border-top: 5px solid var\(--cue-ink\)/);
    expect(css).toMatch(/\.track-listing \.track-listing__actions \{[^}]*vertical-align: middle;/);
  });
});

describe('every library track listing uses the shared TrackListing', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
  it.each([
    'audition/AuditionLibrary.tsx',
    'cues/CuePointsView.tsx',
    'library/LibraryView.tsx',
    'library/LibrarySearchResults.tsx',
    'library/SimilarVibesSection.tsx',
    'drop-lab/CandidateRotation.tsx',
  ])('%s', (file) => {
    const source = src(file);
    expect(source).toContain('<TrackListing');
    expect(source).not.toMatch(/<TrackTable[ >\n]/);
    expect(source).not.toContain('<TrackNameCell');
  });
});
