import { Search, Loader2 } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';

interface LibrarySearchResultsProps {
  query: string;
  results: RekordboxTrack[];
  loading: boolean;
  importId: string | null;
  onTrackClick: (track: RekordboxTrack) => void;
}

const HEADERS = ['Title', 'Artist', 'BPM', 'Key'] as const;

export function LibrarySearchResults({
  query,
  results,
  loading,
  importId,
  onTrackClick,
}: LibrarySearchResultsProps) {
  const label = loading
    ? 'Searching…'
    : results.length > 0
    ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`
    : `No results for "${query}"`;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Search size={13} />
        {label}
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={26} />
        </div>
      )}

      {!loading && !importId && (
        <p className="text-center py-12 text-muted-foreground italic text-sm">
          Import a library to search your tracks.
        </p>
      )}

      {!loading && importId && results.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
          <Search size={28} className="mx-auto text-muted-foreground opacity-30 mb-2" />
          <p className="text-sm text-muted-foreground italic">No tracks matching your search.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          <div className="hidden sm:grid grid-cols-[1fr_1fr_64px_64px] px-4 py-2.5 border-b border-[var(--color-border-faint)]">
            {HEADERS.map((col, i) => (
              <p
                key={col}
                className={cn(
                  'text-[9px] uppercase tracking-widest text-muted-foreground font-bold',
                  i >= 2 && 'text-center',
                )}
              >
                {col}
              </p>
            ))}
          </div>

          <div className="divide-y divide-[var(--color-border-faint)]">
            {results.map((track) => (
              <button
                key={track.id}
                onClick={() => onTrackClick(track)}
                className="w-full text-left group px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {/* Desktop row */}
                <div className="hidden sm:grid grid-cols-[1fr_1fr_64px_64px] items-center">
                  <p className="text-sm font-semibold truncate pr-4 group-hover:text-primary transition-colors">
                    {track.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate pr-4">
                    {track.artist ?? '—'}
                  </p>
                  <p className="text-xs font-mono text-primary text-center">
                    {track.bpm != null ? track.bpm.toFixed(1) : '—'}
                  </p>
                  <p className="text-xs font-mono text-secondary text-center">
                    {formatKey(track.musical_key)}
                  </p>
                </div>

                {/* Mobile row */}
                <div className="sm:hidden">
                  <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                    {track.title}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate flex-1">
                      {track.artist ?? '—'}
                    </p>
                    {track.bpm != null && (
                      <p className="text-[10px] font-mono text-primary shrink-0">
                        {track.bpm.toFixed(1)} BPM
                      </p>
                    )}
                    <p className="text-[10px] font-mono text-secondary shrink-0">
                      {formatKey(track.musical_key)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
