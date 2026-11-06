import { CircleDash, Close } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import type { CatalogGenre } from '../../types';
import { HorizontalScroller } from './HorizontalScroller';
import { isHighlightedGenre, orderGenres } from './genreBrowse';

interface GenreBrowserProps {
  genres: CatalogGenre[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedGenreId: string | null;
  onSelectGenre: (genreId: string | null) => void;
}

/**
 * The genre band: every genre in one row that scrolls sideways, with arrows at the edges and the mouse
 * wheel moving it. "All" is first and is the way back to every artist; while a genre is picked a Clear
 * button stays at the right edge, wherever the row is scrolled to.
 */
export function GenreBrowser({ genres, loading, error, onRetry, selectedGenreId, onSelectGenre }: GenreBrowserProps) {
  if (loading) {
    return (
      <div className="discovery-genres" aria-live="polite">
        <span className="studio-label">Genre</span>
        <span className="discovery-genres-status inline-flex items-center gap-2">
          <CircleDash className="animate-spin text-primary" size={14} /> Loading genres…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="discovery-genres">
        <span className="studio-label">Genre</span>
        <span className="discovery-genres-status inline-flex items-center gap-3">
          <span className="text-red-300">Couldn&apos;t load the genre list.</span>
          <button type="button" onClick={onRetry} className="studio-link">Try again</button>
        </span>
      </div>
    );
  }

  if (genres.length === 0) return null;

  return (
    <div className="discovery-genres" data-testid="genre-browser">
      <span className="studio-label">Genre</span>
      <HorizontalScroller
        ariaLabel="Browse by genre"
        variant="band"
        wheel
        revealKey={selectedGenreId}
        revealSelector='[aria-pressed="true"]'
        testId="genre-scroll-row"
        className="discovery-genre-scroll"
      >
        <button
          type="button"
          aria-pressed={selectedGenreId === null}
          onClick={() => onSelectGenre(null)}
          className="discovery-genre-tab"
        >
          All
        </button>
        {orderGenres(genres).map((genre) => {
          const selected = genre.id === selectedGenreId;
          return (
            <button
              key={genre.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectGenre(selected ? null : genre.id)}
              className={cn('discovery-genre-tab', isHighlightedGenre(genre.name) && 'discovery-genre-tab--highlight')}
            >
              {genre.name}
              <small>{genre.artistCount}</small>
            </button>
          );
        })}
      </HorizontalScroller>
      {selectedGenreId !== null && (
        <button type="button" className="discovery-genre-clear" aria-label="Clear genre filter" onClick={() => onSelectGenre(null)}>
          <Close size={12} /> Clear
        </button>
      )}
    </div>
  );
}
