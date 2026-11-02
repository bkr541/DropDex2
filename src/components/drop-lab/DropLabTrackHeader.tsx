import type { ReactNode } from 'react';
import { StarFilled, Star } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { RekordboxTrack } from '../../types';
import { Artwork } from '../ui/display';
import { camelotKeyColor } from '../ui/display/camelotKey';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';

interface DropLabTrackHeaderProps {
  label: string;
  track: RekordboxTrack | null;
  dropPoint: DropPoint | null;
  muted?: boolean;
  /** `left` sits above the timeline; `right` sits below it, title on the right, like Flip Lab's instrumental. */
  side?: 'left' | 'right';
  actions?: ReactNode;
}

const LABEL = 'uppercase tracking-[0.08em] text-foreground/45';

function Stats({ track, dropPoint }: { track: RekordboxTrack; dropPoint: DropPoint | null }) {
  const key = dropLabKeyLabel(track);
  const rating = track.rating ?? 0;
  return (
    <div className="flex shrink-0 items-center gap-x-3 text-[10px] font-semibold text-muted-foreground">
      <span><span className={LABEL}>BPM</span> <strong className="ml-1 text-foreground/90">{track.bpm != null ? track.bpm.toFixed(1) : '--'}</strong></span>
      <span><span className={LABEL}>Key</span> <strong className="ml-1" style={{ color: camelotKeyColor(key) }}>{key}</strong></span>
      <span className="flex items-center gap-1">
        <span className={LABEL}>Rating</span>
        <strong className="ml-1 flex items-center gap-0.5 text-foreground/90">{rating > 0 ? <><StarFilled size={9} />{rating}/5</> : <><Star size={9} />--</>}</strong>
      </span>
      <span><span className={LABEL}>Drop</span> <strong className="ml-1 text-foreground/90">{dropPoint ? `${dropPoint.label} · ${dropPoint.confidence}` : 'Unavailable'}</strong></span>
    </div>
  );
}

export function DropLabTrackHeader({ label, track, dropPoint, muted, side = 'left', actions }: DropLabTrackHeaderProps) {
  const right = side === 'right';
  const text = (
    <div className={cn('min-w-0', right && 'text-right')}>
      <div className="text-[9px] font-bold uppercase leading-none tracking-[0.2em] text-muted-foreground">{label}</div>
      <h2 className="mt-0.5 truncate text-base font-bold leading-tight tracking-[-0.02em] text-foreground md:text-[17px]">{track?.title ?? 'No track selected'}</h2>
      <p className="truncate text-xs font-medium leading-tight text-muted-foreground">{track?.artist ?? 'Artist not stored'}</p>
    </div>
  );
  const art = <Artwork src={track?.artwork_path ?? null} alt={track ? `Artwork for ${track.title}` : ''} fallbackTitle="No artwork" className="h-10 w-10 shrink-0 rounded-[7px]" />;
  return (
    <div className={cn('flex items-center gap-3.5 px-4 py-2 lg:px-5', right ? 'justify-end' : 'justify-between', muted && 'opacity-70')}>
      {right ? (
        <>
          {track && <Stats track={track} dropPoint={dropPoint} />}
          {text}
          {art}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3.5">
            {art}
            {text}
            {track && <Stats track={track} dropPoint={dropPoint} />}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
        </>
      )}
    </div>
  );
}
