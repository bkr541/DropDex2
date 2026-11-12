import { SkeletonChip } from '../ui/feedback';
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
        <span className="discovery-genres-status" role="status" aria-busy="true" aria-label="Loading genres">
          {[64, 88, 72, 96, 80, 70].map((w) => <SkeletonChip key={w} />)}
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
