import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoverySetTrack } from '../../types';

interface SetTrackRowProps {
  track: DiscoverySetTrack;
  isTimedSet: boolean;
  displayNumber: number | null;
}

export function SetTrackRow({ track, isTimedSet, displayNumber }: SetTrackRowProps) {
  const isWRow = track.played_with_previous;
  const title = track.title;
  const artist = track.artist_text;
  const duration = track.duration_text;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2.5 transition-colors',
        isWRow
          ? 'ml-3 pl-3 border-l-2 border-primary/20 bg-[var(--color-avatar-bg)]/20'
          : 'hover:bg-[var(--color-surface-hover)] rounded-lg cursor-default',
      )}
    >
      {/* Cue / track number / w/ indicator */}
      <div className="w-14 shrink-0 flex items-center justify-end">
        {isWRow ? (
          <span className="text-[9px] font-bold uppercase tracking-wider text-primary/60 px-1.5 py-0.5 rounded bg-primary/10">
            w/
          </span>
        ) : isTimedSet ? (
          <span
            className={cn(
              'text-[11px] font-mono font-bold',
              track.cue_text ? 'text-primary' : 'text-muted-foreground/25',
            )}
          >
            {track.cue_text ?? '—'}
          </span>
        ) : displayNumber != null ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {String(displayNumber).padStart(2, '0')}
          </span>
        ) : null}
      </div>

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'leading-snug truncate font-bold',
            isWRow ? 'text-xs text-muted-foreground' : 'text-sm text-foreground',
          )}
        >
          {title !== null && title !== undefined ? (
            title
          ) : (
            <span className="italic font-normal opacity-40">Unknown Track</span>
          )}
        </p>
        {artist && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{artist}</p>
        )}
      </div>

      {/* Duration */}
      <span className="shrink-0 w-10 text-right text-[10px] font-mono text-muted-foreground">
        {duration ?? ''}
      </span>

      {/* External source link */}
      {track.source_track_url ? (
        <a
          href={track.source_track_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-primary transition-colors"
          title="View on source"
        >
          <ExternalLink size={11} />
        </a>
      ) : (
        <div className="shrink-0 w-5" />
      )}
    </div>
  );
}
