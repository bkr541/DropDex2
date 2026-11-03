import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { RekordboxTrack } from '../../types';
import { TrackIdentity } from '../ui/display';
import { dropLabTrackStats } from './dropLabTrackStats';

interface DropLabTrackHeaderProps {
  label: string;
  track: RekordboxTrack | null;
  dropPoint: DropPoint | null;
  muted?: boolean;
  /** `left` sits above the timeline. `right` sits below it with the title on the right, like Flip Lab's instrumental. */
  side?: 'left' | 'right';
  actions?: ReactNode;
}

/** A Drop Lab track header: the same track identity block the Cue Points header uses. */
export function DropLabTrackHeader({ label, track, dropPoint, muted, side = 'left', actions }: DropLabTrackHeaderProps) {
  const identity = (
    <TrackIdentity
      align={side}
      caption={label}
      title={track?.title}
      subtitle={track?.artist}
      artworkSrc={track?.artwork_path}
      stats={track ? dropLabTrackStats(track, dropPoint) : []}
    />
  );
  return (
    <div
      data-testid={side === 'left' ? 'drop-lab-selected-header' : 'drop-lab-candidate-header'}
      className={cn('flex flex-row items-start gap-3 px-4 lg:px-5', side === 'left' ? 'pb-2 pt-0' : 'py-2', side === 'right' ? 'justify-end' : 'justify-between', muted && 'opacity-70')}
    >
      {identity}
      {actions}
    </div>
  );
}
