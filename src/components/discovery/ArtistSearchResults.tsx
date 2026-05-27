import { motion } from 'motion/react';
import { User } from 'lucide-react';
import type { DiscoveryArtist } from '../../types';

interface ArtistSearchResultsProps {
  results: DiscoveryArtist[];
  onSelect: (artist: DiscoveryArtist) => void;
  query: string;
}

export function ArtistSearchResults({ results, onSelect, query }: ArtistSearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-[var(--color-border-subtle)] rounded-2xl">
        <p className="text-sm text-muted-foreground italic">
          No artists found matching &ldquo;{query}&rdquo;
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Only artists already in the DropDex catalog can be searched.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {results.map((artist) => (
        <motion.button
          key={artist.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(artist)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] hover:border-primary/30 transition-all text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <User size={16} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm text-foreground">{artist.name}</p>
            {artist.matched_alias && (
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-tighter truncate">
                aka {artist.matched_alias}
              </p>
            )}
          </div>
        </motion.button>
      ))}
    </div>
  );
}
