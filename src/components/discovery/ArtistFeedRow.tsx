import { ChevronRight } from '@carbon/icons-react';
import { SetlistFeedCard } from './SetlistFeedCard';
import { DiscoveryAvatar } from './DiscoveryAvatar';
import type { FeedArtist, DiscoverySetlistResult } from '../../types';

interface ArtistFeedRowProps {
  artist: FeedArtist;
  setlists: DiscoverySetlistResult[];
  setlistsLoading: boolean;
  onSeeAll: () => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
}

const LATEST_COUNT = 3;

/** One top artist as a table row: a large photo, their name over their genres, how many sets, and their latest setlists. */
export function ArtistFeedRow({ artist, setlists, setlistsLoading, onSeeAll, onOpenSetlist }: ArtistFeedRowProps) {
  const genres = artist.genres.slice(0, 3).map((genre) => genre.name).join(' · ');
  return (
    <tr
      className="discovery-feed-row"
      tabIndex={0}
      data-testid="discovery-feed-row"
      aria-label={`Open ${artist.name}`}
      onClick={onSeeAll}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSeeAll();
        }
      }}
    >
      <td>
        <div className="discovery-feed-artist">
          <DiscoveryAvatar name={artist.name} imageUrl={artist.profile_image_url} large />
          <div>
            <p className="discovery-feed-name">{artist.name}</p>
            <p className="discovery-feed-genres">{genres || 'No genres yet'}</p>
          </div>
        </div>
      </td>
      <td className="discovery-feed-sets">{artist.setlist_count.toLocaleString()}</td>
      <td>
        {setlistsLoading ? (
          <div className="discovery-feed-latest" aria-hidden="true">
            {Array.from({ length: LATEST_COUNT }).map((_, index) => <span key={index} className="discovery-skeleton discovery-setlist-skeleton" />)}
          </div>
        ) : setlists.length === 0 ? (
          <span className="studio-muted">No setlists loaded yet.</span>
        ) : (
          <div className="discovery-feed-latest">
            {setlists.slice(0, LATEST_COUNT).map((setlist) => (
              <SetlistFeedCard key={setlist.id} setlist={setlist} onOpen={onOpenSetlist} />
            ))}
          </div>
        )}
      </td>
      <td className="discovery-feed-open" aria-hidden="true"><ChevronRight size={16} /></td>
    </tr>
  );
}
