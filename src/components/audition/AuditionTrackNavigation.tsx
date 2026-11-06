import { ChevronLeft, ChevronRight } from '@carbon/icons-react';

interface AuditionTrackNavigationProps {
  /** "14 of 387", or null when the track is not in the current list. */
  positionLabel: string | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

/** Where the selected track is in the list, with arrows to step to the one before or after it. */
export function AuditionTrackNavigation({ positionLabel, onPrevious, onNext }: AuditionTrackNavigationProps) {
  return (
    <div className="audition-track-navigation" role="group" aria-label="Move between tracks">
      <button type="button" aria-label="Previous track" title="Previous track" className="audition-track-step" disabled={!onPrevious} onClick={() => onPrevious?.()}><ChevronLeft size={18} /></button>
      <span data-testid="audition-position">{positionLabel ?? '—'}</span>
      <button type="button" aria-label="Next track" title="Next track" className="audition-track-step" disabled={!onNext} onClick={() => onNext?.()}><ChevronRight size={18} /></button>
    </div>
  );
}
