import { CircleDash } from '@carbon/icons-react';
import type { DiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import { ArtistFeedRow } from './ArtistFeedRow';
import type { DiscoveryArtist, DiscoverySetlistResult, FeedArtist } from '../../types';

interface DiscoveryHomeFeedProps {
  feed: DiscoveryFeed;
  onSelectArtist: (artist: DiscoveryArtist) => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
}

function toDiscoveryArtist(feed: FeedArtist): DiscoveryArtist {
  return {
    id: feed.id,
    name: feed.name,
    normalized_name: feed.normalized_name,
    matched_alias: null,
    profile_image_url: feed.profile_image_url,
  };
}

/** The top artists, one row each, with their latest setlists. */
export function DiscoveryHomeFeed({ feed, onSelectArtist, onOpenSetlist }: DiscoveryHomeFeedProps) {
  const { artists, setlistsByArtist, loading, error, retry } = feed;

  if (loading) {
    return (
      <div className="studio-empty" role="status">
        <CircleDash className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="studio-empty" role="alert">
        <p className="text-red-300">{error}</p>
        <p><button type="button" onClick={retry} className="studio-link">Try again</button></p>
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div className="studio-empty">
        <p>No artist setlists in the catalog yet.</p>
        <p>Search for an artist above to add their setlists to this list.</p>
      </div>
    );
  }

  return (
    <section data-testid="discovery-feed" aria-label="Top artists">
      <table className="studio-table">
        <thead>
          <tr>
            <th scope="col">Top artists</th>
            <th scope="col">Sets</th>
            <th scope="col">Latest setlists</th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {artists.map((artist) => {
            const setlists = setlistsByArtist.get(artist.id);
            return (
              <ArtistFeedRow
                key={artist.id}
                artist={artist}
                setlists={setlists ?? []}
                setlistsLoading={setlists === undefined}
                onSeeAll={() => onSelectArtist(toDiscoveryArtist(artist))}
                onOpenSetlist={onOpenSetlist}
              />
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
