import { Checkmark, ChevronLeft, ChevronRight, Close, Renew } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { Artwork } from '../ui/display/Artwork';
import { KeyBadge } from '../ui/display/KeyBadge';
import { formatClock } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionTrackHeaderProps {
  track: RekordboxTrack | null;
  durationMs: number | null;
  /** "14 of 387", or null when the track is not in the current list. */
  positionLabel: string | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

// Keep / Maybe / Remove are shown so the layout is final, but they are not
// connected to anything yet. They stay disabled and say so on hover.
const DECISIONS = [
  { id: 'keep', label: 'Keep', Icon: Checkmark },
  { id: 'maybe', label: 'Maybe', Icon: Renew },
  { id: 'remove', label: 'Remove', Icon: Close },
] as const;

const NAV_BUTTON = 'audition-track-step';

export function AuditionTrackHeader({ track, durationMs, positionLabel, onPrevious, onNext }: AuditionTrackHeaderProps) {
  return (
    <section data-testid="audition-track-header" aria-label="Selected track" className="audition-header">
      <div className="audition-header-identity">
        <Artwork
          src={track?.artwork_path}
          alt={track ? `Artwork for ${track.title}` : 'No track selected'}
          fallbackTitle="No artwork"
          className="audition-cover"
        />
        <div className="audition-header-copy">
          <p className="audition-eyebrow"><span /> Audition <span className="audition-eyebrow-divider">/</span> Listening room</p>
          <h2 title={track?.title}>{track?.title ?? 'Select a track'}</h2>
          <p className="audition-artist">{track ? track.artist ?? 'Artist Not Available' : 'Pick a track from the library below.'}</p>
          {track && <div className="audition-track-details">
            <span><small>Tempo</small><strong>{track.bpm != null ? `${track.bpm.toFixed(0)} BPM` : '— BPM'}</strong></span>
            <span><small>Key</small><KeyBadge camelotKey={track.musical_key} variant="text" className="audition-header-key" /></span>
            <span><small>Genre</small><strong>{track.genre || '—'}</strong></span>
          </div>}
        </div>
      </div>
      <div className="audition-duration"><span>{durationMs != null ? formatClock(durationMs) : '—:—'}</span><small>Track length</small></div>
      <div className="audition-header-tools">
        <div className="audition-track-navigation" role="group" aria-label="Move between tracks">
          <button type="button" aria-label="Previous track" title="Previous track" className={NAV_BUTTON} disabled={!onPrevious} onClick={() => onPrevious?.()}><ChevronLeft size={18} /></button>
          <span data-testid="audition-position">{positionLabel ?? '—'}</span>
          <button type="button" aria-label="Next track" title="Next track" className={NAV_BUTTON} disabled={!onNext} onClick={() => onNext?.()}><ChevronRight size={18} /></button>
        </div>
        <div className="audition-decisions" role="group" aria-label="Track decision">
          {DECISIONS.map(({ id, label, Icon }) => (
            <span key={id} title="Coming soon">
              <button type="button" disabled aria-label={`${label} (coming soon)`} data-testid={`audition-decision-${id}`} className={cn('audition-decision', `audition-decision--${id}`)}><Icon size={14} />{label}</button>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
