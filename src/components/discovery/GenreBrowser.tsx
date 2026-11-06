import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleDash, Close } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import type { CatalogGenre } from '../../types';
import { isHighlightedGenre, orderGenres } from './genreBrowse';

interface GenreBrowserProps {
  genres: CatalogGenre[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedGenreId: string | null;
  onSelectGenre: (genreId: string | null) => void;
}

/** How far one arrow press moves the row. */
const SCROLL_STEP = 320;

/**
 * The genre band: every genre in one row that scrolls sideways, with arrows at the edges and the mouse
 * wheel moving it. "All" is first and is the way back to every artist; while a genre is picked a Clear
 * button stays at the right edge, wherever the row is scrolled to.
 */
export function GenreBrowser({ genres, loading, error, onRetry, selectedGenreId, onSelectGenre }: GenreBrowserProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const hasGenres = !loading && !error && genres.length > 0;

  const updateEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setCanScrollLeft(row.scrollLeft > 1);
    setCanScrollRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !hasGenres) return undefined;
    updateEdges();
    // A mouse wheel scrolls up and down; in this row it should move the genres sideways.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (row.scrollWidth <= row.clientWidth) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    row.addEventListener('scroll', updateEdges, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    observer?.observe(row);
    return () => {
      row.removeEventListener('wheel', onWheel);
      row.removeEventListener('scroll', updateEdges);
      observer?.disconnect();
    };
  }, [hasGenres, genres.length, updateEdges]);

  // Keep the picked genre in view.
  useEffect(() => {
    if (!selectedGenreId) return;
    rowRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [selectedGenreId]);

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

  const scrollBy = (distance: number) => rowRef.current?.scrollBy({ left: distance, behavior: 'smooth' });

  return (
    <div className="discovery-genres" data-testid="genre-browser">
      <span className="studio-label">Genre</span>
      <div className="discovery-genre-scroll">
        {canScrollLeft && (
          <button type="button" className="discovery-genre-arrow discovery-genre-arrow--left" aria-label="Scroll genres left" onClick={() => scrollBy(-SCROLL_STEP)}>
            <ChevronLeft size={16} />
          </button>
        )}
        <div ref={rowRef} className="discovery-genre-tabs" role="group" aria-label="Browse by genre" data-testid="genre-scroll-row">
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
        </div>
        {canScrollRight && (
          <button type="button" className="discovery-genre-arrow discovery-genre-arrow--right" aria-label="Scroll genres right" onClick={() => scrollBy(SCROLL_STEP)}>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      {selectedGenreId !== null && (
        <button type="button" className="discovery-genre-clear" aria-label="Clear genre filter" onClick={() => onSelectGenre(null)}>
          <Close size={12} /> Clear
        </button>
      )}
    </div>
  );
}
