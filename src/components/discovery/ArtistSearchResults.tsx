import type { DiscoveryArtist } from '../../types';
import { DiscoveryAvatar } from './DiscoveryAvatar';

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
      <div className="discovery-rows">
        {results.map((artist) => (
          <button key={artist.id} type="button" className="discovery-row" onClick={() => onSelect(artist)}>
            <DiscoveryAvatar name={artist.name} imageUrl={artist.profile_image_url} />
            <div>
              <p className="studio-name">{artist.name}</p>
              {artist.matched_alias && <p className="studio-sub">aka {artist.matched_alias}</p>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
