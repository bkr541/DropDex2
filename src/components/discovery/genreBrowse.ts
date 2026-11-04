import type { CatalogGenre } from '../../types';

/** Genres shown first and highlighted in the genre browser. */
export const HIGHLIGHTED_GENRES = ['Melodic Dubstep', 'Future Bass'] as const;

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HIGHLIGHTED = new Set(HIGHLIGHTED_GENRES.map(normalize));

export function isHighlightedGenre(name: string): boolean {
  return HIGHLIGHTED.has(normalize(name));
}

/** Highlighted genres first (in the order listed above), then everything else A to Z. */
export function orderGenres(genres: readonly CatalogGenre[]): CatalogGenre[] {
  const rank = (genre: CatalogGenre) => HIGHLIGHTED_GENRES.map(normalize).indexOf(normalize(genre.name));
  return [...genres].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra >= 0 || rb >= 0) {
      if (ra >= 0 && rb >= 0) return ra - rb;
      return ra >= 0 ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
