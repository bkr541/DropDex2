import { useState, useRef } from 'react';
import { ChevronRight, User } from 'lucide-react';
import { MusicNote01Icon } from 'hugeicons-react';
import { SetlistFeedCard } from './SetlistFeedCard';
import type { FeedArtist, DiscoverySetlistResult } from '../../types';

interface ArtistFeedRowProps {
  artist: FeedArtist;
  setlists: DiscoverySetlistResult[];
  setlistsLoading: boolean;
  onSeeAll: () => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
}

function ArtistAvatar({ artist }: { artist: FeedArtist }) {
  const [err, setErr] = useState(false);
  const initials = artist.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (artist.profile_image_url && !err) {
    return (
      <img
        src={artist.profile_image_url}
        alt={artist.name}
        className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/20 shadow-md shrink-0"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-full bg-primary/10 ring-2 ring-primary/20 shadow-md flex items-center justify-center shrink-0">
      {initials ? (
        <span className="text-sm font-black text-primary">{initials}</span>
      ) : (
        <User size={20} className="text-primary/60" />
      )}
    </div>
  );
}

export function ArtistFeedRow({
  artist,
  setlists,
  setlistsLoading,
  onSeeAll,
  onOpenSetlist,
}: ArtistFeedRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <ArtistAvatar artist={artist} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-base leading-tight truncate">{artist.name}</h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {artist.genres.slice(0, 3).map((g) => (
              <span
                key={g.id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/15"
              >
                <MusicNote01Icon size={8} className="shrink-0" />
                {g.name}
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground font-mono">
              {artist.setlist_count.toLocaleString()} sets
            </span>
          </div>
        </div>

        {/* See All */}
        <button
          onClick={onSeeAll}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors shrink-0"
        >
          See All
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Horizontal scroll row */}
      {setlistsLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="w-44 shrink-0 rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] animate-pulse"
            >
              <div className="aspect-video bg-primary/10" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-primary/10 rounded w-3/4" />
                <div className="h-2 bg-primary/10 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : setlists.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No setlists loaded yet.</p>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ scrollbarWidth: 'thin' }}
        >
          {setlists.map((setlist) => (
            <SetlistFeedCard key={setlist.id} setlist={setlist} onOpen={onOpenSetlist} />
          ))}
        </div>
      )}
    </div>
  );
}
