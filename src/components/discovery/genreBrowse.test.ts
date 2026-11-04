import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isHighlightedGenre, orderGenres } from './genreBrowse';
import { parseAppRoute } from '../../navigation/appRoutes';

const genre = (id: string, name: string, artistCount = 1) => ({ id, name, artistCount });
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('genre ordering', () => {
  it('puts Melodic Dubstep and Future Bass first, then the rest A to Z', () => {
    const ordered = orderGenres([genre('1', 'Trap'), genre('2', 'Future Bass'), genre('3', 'Dubstep'), genre('4', 'Melodic Dubstep'), genre('5', 'Bass House')]);
    expect(ordered.map((g) => g.name)).toEqual(['Melodic Dubstep', 'Future Bass', 'Bass House', 'Dubstep', 'Trap']);
  });
  it('recognises the highlighted genres regardless of case and punctuation', () => {
    expect(isHighlightedGenre('melodic-dubstep')).toBe(true);
    expect(isHighlightedGenre('Future  bass')).toBe(true);
    expect(isHighlightedGenre('Trap')).toBe(false);
  });
});

describe('Artist Search is merged into Discovery', () => {
  it('sends old /search links to Discovery', () => {
    expect(parseAppRoute('/search')).toEqual({ name: 'discovery' });
  });
  it('removes the Search page, nav entries and route', () => {
    const app = read('../../App.tsx');
    expect(app).not.toContain("'search'");
    expect(app).not.toContain('SearchView');
    expect(read('../../navigation/appRoutes.ts')).not.toContain("name: 'search'");
  });
  it('keeps the genre browser visible alongside an artist page and the genre list', () => {
    const view = read('./DiscoveryView.tsx');
    expect(view).toContain('<GenreBrowser');
    // It sits with the search box, which is shown for the home feed, an artist page and a genre list.
    expect(view.indexOf('<GenreBrowser')).toBeLessThan(view.indexOf('<TrackListPage'));
    expect(view).toContain('<GenreArtistGrid');
    expect(view).toContain('setSelectedGenreId(null)');
  });
});
