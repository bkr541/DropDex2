import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { filterLibraryCollection, matchesLibrarySearch, recordOptions, LibraryFilterRow } from './LibraryFilterRow';
import { SpotifyMetadataBrowser } from '../profile/SpotifyMetadataBrowser';

vi.mock('../../lib/api/externalAccounts', () => ({ fetchSpotifyPlaylists: vi.fn(), fetchSpotifyPlaylistTracks: vi.fn() }));

const records = [
  { name: 'Zulu', count: 0, owner: 'Alice' },
  { name: 'House', count: 1, owner: 'Bob' },
  { name: 'Acid House', count: 4, owner: 'Alice' },
  { name: 'Techno', count: 12, owner: 'Bob' },
];
const filter = (search = '', count = '', sort = 'original') => filterLibraryCollection(records, { search, count, sort },
  (record) => record.name, (record) => record.count, (record) => `${record.name} ${record.owner}`);

describe('Library collection filters', () => {
  it('combines trimmed, case-insensitive search with a track-count filter', () => {
    expect(filter(' HOUSE ', 'few').map((record) => record.name)).toEqual(['Acid House']);
    expect(filter('alice').map((record) => record.name)).toEqual(['Zulu', 'Acid House']);
    expect(filter('unmatched')).toEqual([]);
    expect(matchesLibrarySearch(' house ', null, 'HOUSE', undefined)).toBe(true);
  });

  it('handles empty playlists, nonempty playlists, and genre/artist count ranges', () => {
    expect(filter('', 'empty').map((record) => record.count)).toEqual([0]);
    expect(filter('', 'with-tracks').map((record) => record.count)).toEqual([1, 4, 12]);
    expect(filter('', 'one').map((record) => record.count)).toEqual([1]);
    expect(filter('', 'many').map((record) => record.count)).toEqual([12]);
  });

  it('sorts the filtered results without changing the library order', () => {
    expect(filter('house', '', 'name').map((record) => record.name)).toEqual(['Acid House', 'House']);
    expect(filter('', '', 'most').map((record) => record.count)).toEqual([12, 4, 1, 0]);
    expect(filter('', '', 'fewest').map((record) => record.count)).toEqual([0, 1, 4, 12]);
    expect(records.map((record) => record.name)).toEqual(['Zulu', 'House', 'Acid House', 'Techno']);
  });

  it('builds dropdown options from available metadata without duplicate or missing values', () => {
    expect(recordOptions(['WAV', null, 'MP3', 'WAV', '', undefined])).toEqual([
      { value: '', label: 'All' }, { value: 'MP3', label: 'MP3' }, { value: 'WAV', label: 'WAV' },
    ]);
  });
});

describe('shared Library filter presentation', () => {
  it('uses the Cue Points style scope and the shared labeled Search and dropdown inputs', () => {
    const markup = renderToStaticMarkup(createElement(LibraryFilterRow, {
      search: '', onSearchChange: vi.fn(), label: 'Playlists', placeholder: 'Search playlists…',
      filters: [{ label: 'Tracks', value: '', onChange: vi.fn(), options: [{ value: '', label: 'All' }] }],
    }));
    expect(markup).toContain('class="cue-studio"');
    expect(markup).toContain('cue-browser__filters');
    expect(markup).toContain('dd-search-control__label');
    expect(markup).toContain('aria-label="Search playlists"');
    expect(markup).toContain('cue-browser__filter');
  });

  it('renders Spotify search, tailored filters, and the icon-only refresh action even while loading', () => {
    const markup = renderToStaticMarkup(createElement(SpotifyMetadataBrowser, { accessToken: 'test-token' }));
    expect(markup).toContain('aria-label="Search spotify playlists"');
    for (const label of ['Owner', 'Tracks', 'Sort']) expect(markup).toContain(`>${label}</p>`);
    const refresh = markup.match(/<button[^>]*aria-label="Refresh Spotify playlists"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(refresh).toContain('cue-action-icon');
    expect(refresh?.replace(/<[^>]*>/g, '').trim()).toBe('');
  });
});
