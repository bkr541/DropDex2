import type { DiscoveryArtist } from '../../types';
import { ArtistCard } from './ArtistCard';

interface ArtistSearchResultsProps {
  results: DiscoveryArtist[];
  onSelect: (artist: DiscoveryArtist) => void;
  query: string;
}

export function ArtistSearchResults({ results, onSelect, query }: ArtistSearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="studio-empty" data-testid="artist-search-results">
        <p>No artists found matching &ldquo;{query}&rdquo;.</p>
        <p>Only artists already in the DropDex catalog can be searched.</p>
      </div>
    );
  }

  return (
    <section data-testid="artist-search-results" aria-label="Search results">
      <div className="discovery-section-head">
        <h3 className="studio-title">Results</h3>
        <span className="studio-label">{results.length} {results.length === 1 ? 'artist' : 'artists'}</span>
      </div>
      <div className="discovery-card-grid">
        {results.map((artist) => (
          <ArtistCard
            key={artist.id}
            name={artist.name}
            imageUrl={artist.profile_image_url}
            subtitle={artist.matched_alias ? `aka ${artist.matched_alias}` : null}
            onOpen={() => onSelect(artist)}
          />
        ))}
      </div>
    </section>
  );
}
