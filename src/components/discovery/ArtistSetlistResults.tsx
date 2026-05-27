import { Loader2, ListMusic } from 'lucide-react';
import { ArtistSetlistCard } from './ArtistSetlistCard';
import type { DiscoverySetlistResult } from '../../types';

interface ArtistSetlistResultsProps {
  setlists: DiscoverySetlistResult[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedSetlist: DiscoverySetlistResult | null;
  onSelectSetlist: (setlist: DiscoverySetlistResult) => void;
}

export function ArtistSetlistResults({
  setlists,
  total,
  loading,
  error,
  selectedSetlist,
  onSelectSetlist,
}: ArtistSetlistResultsProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-red-400 font-bold text-sm">Failed to load setlists</p>
        <p className="text-xs text-muted-foreground font-mono">{error}</p>
      </div>
    );
  }

  if (setlists.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl space-y-3">
        <ListMusic size={32} className="mx-auto text-muted-foreground opacity-40" />
        <div>
          <p className="text-sm font-bold text-muted-foreground">No setlists stored yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click &ldquo;Find Setlists&rdquo; to scrape 1001Tracklists for this artist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <ListMusic size={12} />
          Saved Setlists
        </h3>
        <span className="text-[10px] text-muted-foreground font-mono">{total} TOTAL</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {setlists.map((setlist) => (
          <ArtistSetlistCard
            key={setlist.id}
            setlist={setlist}
            isSelected={selectedSetlist?.id === setlist.id}
            onSelect={onSelectSetlist}
          />
        ))}
      </div>
    </div>
  );
}
