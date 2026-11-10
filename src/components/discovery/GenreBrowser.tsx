import { Refresh } from 'iconoir-react/regular';
import type { CatalogGenre } from '../../types';
import { FilterDropdown } from '../ui/controls';
import { orderGenres } from './genreBrowse';

interface GenreBrowserProps {
  genres: CatalogGenre[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedGenreId: string | null;
  onSelectGenre: (genreId: string | null) => void;
}

export function GenreBrowser({ genres, loading, error, onRetry, selectedGenreId, onSelectGenre }: GenreBrowserProps) {
  return (
    <div className="discovery-genre-filter" data-testid="genre-browser">
      {loading ? (
        <span className="discovery-genres-status" role="status">
          <Refresh className="animate-spin text-control-primary" width={14} height={14} aria-hidden="true" /> Loading genres…
        </span>
      ) : error ? (
        <span className="discovery-genres-status" role="alert">
          <span className="text-red-300">Couldn&apos;t load the genre list.</span>
          <button type="button" onClick={onRetry} className="studio-link">Try again</button>
        </span>
      ) : (
        <FilterDropdown
          label="Genre"
          value={selectedGenreId ?? ''}
          onChange={(value) => onSelectGenre(value || null)}
          searchable
          options={[
            { value: '', label: 'All' },
            ...orderGenres(genres).map(({ id, name, artistCount }) => ({
              value: id, label: `${name} (${artistCount.toLocaleString()})`,
            })),
          ]}
        />
      )}
    </div>
  );
}
