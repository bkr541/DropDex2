import { Refresh } from 'iconoir-react/regular';
import { useGenreArtists } from '../../hooks/useGenreArtists';
import type { DiscoveryArtist, GenreBrowseArtist } from '../../types';
import { ArtistCard } from './ArtistCard';

interface GenreArtistGridProps {
  genreId: string;
  genreName: string;
  onSelectArtist: (artist: DiscoveryArtist) => void;
}

function toDiscoveryArtist(artist: GenreBrowseArtist): DiscoveryArtist {
  return { id: artist.id, name: artist.name, normalized_name: artist.normalized_name, matched_alias: null, profile_image_url: artist.profile_image_url };
}

/** The artists in one genre. Clicking one opens it in Discovery, the same as picking it from the search results. */
export function GenreArtistGrid({ genreId, genreName, onSelectArtist }: GenreArtistGridProps) {
  const { artists, loading, error, retry } = useGenreArtists(genreId);

  return (
    <section data-testid="genre-artist-grid" aria-label={`${genreName} artists`}>
      <div className="discovery-section-head">
        <h3 className="studio-title">{genreName}</h3>
        {!loading && !error && <span className="studio-label">{artists.length} {artists.length === 1 ? 'artist' : 'artists'}</span>}
      </div>

      {loading && (
        <div className="studio-empty"><Refresh className="animate-spin text-control-primary" width={24} height={24} aria-hidden="true" /></div>
      )}

      {error && (
        <div className="studio-empty" role="alert">
          <p className="text-red-300">Couldn&apos;t load the artists in this genre.</p>
          <p><button type="button" onClick={retry} className="studio-link">Try again</button></p>
        </div>
      )}

      {!loading && !error && artists.length === 0 && (
        <div className="studio-empty"><p>No artists in this genre yet.</p></div>
      )}

      {!loading && !error && artists.length > 0 && (
        <div className="discovery-card-grid">
          {artists.map((artist) => (
            <ArtistCard
              key={artist.id}
              name={artist.name}
              imageUrl={artist.profile_image_url}
              subtitle={genreName}
              onOpen={() => onSelectArtist(toDiscoveryArtist(artist))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
