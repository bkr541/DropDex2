import { useState } from 'react';
import { CircleDash } from '@carbon/icons-react';
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

const COLLAPSED_COUNT = 14;

/** A row of genre chips. Picking one lists that genre's artists; picking it again goes back. */
export function GenreBrowser({ genres, loading, error, onRetry, selectedGenreId, onSelectGenre }: GenreBrowserProps) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
        <CircleDash className="animate-spin text-primary" size={14} /> Loading genres…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 px-1 text-xs">
        <span className="text-red-400">Couldn&apos;t load the genre list.</span>
        <button type="button" onClick={onRetry} className="font-bold text-primary hover:underline">Try again</button>
      </div>
    );
  }

  if (genres.length === 0) return null;

  const ordered = orderGenres(genres);
  const selectedIndex = ordered.findIndex((genre) => genre.id === selectedGenreId);
  // Keep the chosen genre visible even when the list is collapsed.
  const visible = expanded || ordered.length <= COLLAPSED_COUNT
    ? ordered
    : ordered.filter((genre, index) => index < COLLAPSED_COUNT || index === selectedIndex);

  return (
    <div className="space-y-2" data-testid="genre-browser">
      <p className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Browse by genre</p>
      <div className="flex flex-wrap gap-2">
        {visible.map((genre) => {
          const selected = genre.id === selectedGenreId;
          const highlighted = isHighlightedGenre(genre.name);
          return (
            <button
              key={genre.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectGenre(selected ? null : genre.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition-colors',
                selected
                  ? 'border-primary bg-primary text-[var(--color-background)]'
                  : highlighted
                    ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              {genre.name}
              <span className={cn('font-mono text-[10px] font-medium', selected ? 'opacity-80' : 'opacity-60')}>{genre.artistCount}</span>
            </button>
          );
        })}
        {ordered.length > COLLAPSED_COUNT && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-full px-3 py-1 text-[11px] font-bold text-primary hover:underline"
          >
            {expanded ? 'Show fewer' : `Show all ${ordered.length} genres`}
          </button>
        )}
      </div>
    </div>
  );
}
