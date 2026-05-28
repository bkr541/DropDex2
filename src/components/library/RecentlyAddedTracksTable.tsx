import { History, Loader2 } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';

interface RecentlyAddedTracksTableProps {
  tracks: RekordboxTrack[];
  loading: boolean;
  onTrackClick: (track: RekordboxTrack) => void;
}

const HEADERS = ['Title', 'Artist', 'BPM', 'Key', 'Added'] as const;

export function RecentlyAddedTracksTable({
  tracks,
  loading,
  onTrackClick,
}: RecentlyAddedTracksTableProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <History size={13} /> Recently Added
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      )}

      {!loading && tracks.length === 0 && (
        <p className="text-center py-8 text-muted-foreground text-sm italic">
          No recently dated tracks found.
        </p>
      )}

      {!loading && tracks.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          {/* Column headers — hidden on mobile */}
          <div className="hidden sm:grid grid-cols-[1fr_1fr_64px_64px_92px] px-4 py-2.5 border-b border-[var(--color-border-faint)]">
            {HEADERS.map((col, i) => (
              <p
                key={col}
                className={cn(
                  'text-[9px] uppercase tracking-widest text-muted-foreground font-bold',
                  i >= 2 && 'text-center',
                  i === 4 && 'text-right',
                )}
              >
                {col}
              </p>
            ))}
          </div>

          <div className="divide-y divide-[var(--color-border-faint)]">
            {tracks.map((track) => (
              <button
                key={track.id}
                onClick={() => onTrackClick(track)}
                className="w-full text-left group px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {/* Desktop row */}
                <div className="hidden sm:grid grid-cols-[1fr_1fr_64px_64px_92px] items-center">
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
                  <p className="text-[10px] text-muted-foreground text-right tabular-nums">
                    {track.date_added?.slice(0, 10) ?? '—'}
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
    </section>
  );
}
