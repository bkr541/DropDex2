import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { Artwork } from './Artwork';

export interface TrackIdentityStat {
  label: string;
  value: ReactNode;
  /** Optional color for the value, e.g. the Camelot key color. */
  color?: string;
}

export interface TrackIdentityProps {
  title: string | null | undefined;
  /** Normally the artist. */
  subtitle?: string | null;
  artworkSrc?: string | null;
  stats?: TrackIdentityStat[];
  /** `left` is the Cue Points header. `right` mirrors it: right-aligned title, then stats beside the artist, then artwork. */
  align?: 'left' | 'right';
  compact?: boolean;
  /** Small label above the title, for screens that show more than one track. */
  caption?: ReactNode;
  /** Heading level for the title. */
  as?: 'h1' | 'h2' | 'h3';
  emptyTitle?: string;
  className?: string;
}

const STAT_LABEL = 'uppercase tracking-[0.08em] text-foreground/45';

function Stats({ stats, compact }: { stats: TrackIdentityStat[]; compact: boolean }) {
  if (stats.length === 0) return null;
  return (
    <div className={cn('track-identity__stats flex items-center font-semibold text-muted-foreground', compact ? 'mt-0.5 flex-wrap gap-x-3 gap-y-0.5 text-[9px]' : 'shrink-0 gap-x-4 text-[10px]')}>
      {stats.map((stat) => (
        <span key={stat.label} className="track-identity__stat flex items-center">
          <span className={cn(STAT_LABEL, 'track-identity__stat-label')}>{stat.label}</span>
          <strong className="track-identity__stat-value ml-1 text-foreground/90" style={stat.color ? { color: stat.color } : undefined}>{stat.value}</strong>
        </span>
      ))}
    </div>
  );
}

/**
 * Artwork, title, artist and a row of labeled stats, exactly as the Cue Points
 * header shows the selected track. Every screen that names a track uses this.
 */
export function TrackIdentity({
  title, subtitle, artworkSrc, stats = [], align = 'left', compact = false, caption, as: Heading = 'h2', emptyTitle = 'No track selected', className,
}: TrackIdentityProps) {
  const right = align === 'right';
  const artist = subtitle ?? 'Artist Not Available';
  const artwork = (
    <Artwork
      src={artworkSrc ?? null}
      alt={title ? `Artwork for ${title}` : ''}
      fallbackTitle="No artwork"
      className={cn('shrink-0 rounded-[7px]', compact ? 'h-10 w-10' : 'h-9 w-9')}
    />
  );
  const captionNode = caption ? (
    <div className={cn('text-[9px] font-bold uppercase leading-none tracking-[0.2em] text-muted-foreground', right && 'text-right')}>{caption}</div>
  ) : null;
  const titleNode = (
    <Heading className={cn('truncate font-bold leading-tight tracking-[-0.02em] text-foreground', compact ? 'text-base' : 'text-base md:text-[17px]', caption && 'mt-0.5', right && 'text-right')}>
      {title ?? emptyTitle}
    </Heading>
  );

  if (right) {
    // The left layout mirrored: title on top, then the stats and the artist, with the artwork on the right.
    return (
      <div className={cn('flex min-w-0 flex-1 items-center justify-end', compact ? 'gap-2.5' : 'gap-3.5', className)}>
        <div className="min-w-0 flex-1">
          {captionNode}
          {titleNode}
          <div className={cn('flex min-w-0 items-center justify-end', compact ? 'flex-wrap gap-x-3' : 'gap-4')}>
            <Stats stats={stats} compact={compact} />
            <p className={cn('truncate text-right font-medium leading-tight text-muted-foreground', compact ? 'text-[10px]' : 'min-w-0 text-xs')}>{artist}</p>
          </div>
        </div>
        {artwork}
      </div>
    );
  }

  return (
    <div className={cn('track-identity flex min-w-0 flex-1 items-center', compact ? 'gap-2.5' : 'gap-3.5', className)}>
      {artwork}
      <div className="track-identity__text min-w-0 flex-1">
        {captionNode}
        {titleNode}
        <div className={compact ? undefined : 'track-identity__meta flex min-w-0 items-center gap-4'}>
          <p className={cn('truncate font-medium leading-tight text-muted-foreground', compact ? 'text-[10px]' : 'min-w-0 text-xs')}>{artist}</p>
          <Stats stats={stats} compact={compact} />
        </div>
      </div>
    </div>
  );
}
