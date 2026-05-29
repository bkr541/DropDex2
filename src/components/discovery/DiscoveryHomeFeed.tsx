import { Loader2 } from 'lucide-react';
import { useDiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import { ArtistFeedRow } from './ArtistFeedRow';
import type { DiscoveryArtist, DiscoverySetlistResult, FeedArtist } from '../../types';

interface DiscoveryHomeFeedProps {
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

export function DiscoveryHomeFeed({ onSelectArtist, onOpenSetlist }: DiscoveryHomeFeedProps) {
  const { artists, setlistsByArtist, loading } = useDiscoveryFeed();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div className="text-center py-20 space-y-2">
        <p className="text-sm text-muted-foreground">No artist setlists in the catalog yet.</p>
        <p className="text-xs text-muted-foreground opacity-60">
          Search for an artist above and click &ldquo;Find Setlists&rdquo; to populate the feed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
        Top Artists
      </p>
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
    </div>
  );
}
