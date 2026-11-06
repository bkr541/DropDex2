import { ArtistCard } from './ArtistCard';
import { HorizontalScroller } from './HorizontalScroller';
import { SetlistFeedCard } from './SetlistFeedCard';
import type { FeedArtist, DiscoverySetlistResult } from '../../types';

interface ArtistFeedRowProps {
  artist: FeedArtist;
  setlists: DiscoverySetlistResult[];
  setlistsLoading: boolean;
  onSeeAll: () => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
}

const LOADING_CARDS = 5;

/** One top artist as a shelf: their card first, then their latest setlists, all in one row that scrolls sideways. */
export function ArtistFeedRow({ artist, setlists, setlistsLoading, onSeeAll, onOpenSetlist }: ArtistFeedRowProps) {
  const genres = artist.genres.slice(0, 3).map((genre) => genre.name).join(' · ');
  return (
    <div className="discovery-shelf" data-testid="discovery-feed-row">
      <HorizontalScroller ariaLabel={`${artist.name} and their latest setlists`}>
        <ArtistCard name={artist.name} imageUrl={artist.profile_image_url} subtitle={genres || null} setCount={artist.setlist_count} onOpen={onSeeAll} />
        {setlistsLoading
          ? Array.from({ length: LOADING_CARDS }).map((_, index) => <span key={index} className="discovery-skeleton discovery-setlist-skeleton" aria-hidden="true" />)
          : setlists.length === 0
            ? <span className="discovery-shelf-empty">No setlists loaded yet.</span>
            : setlists.map((setlist) => <SetlistFeedCard key={setlist.id} setlist={setlist} onOpen={onOpenSetlist} />)}
      </HorizontalScroller>
    </div>
  );
}
