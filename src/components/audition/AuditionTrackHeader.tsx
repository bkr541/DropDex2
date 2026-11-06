import { Artwork } from '../ui/display/Artwork';
import { formatCamelotCode } from '../ui/display/camelotKey';
import { formatClock } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionTrackHeaderProps {
  track: RekordboxTrack | null;
  durationMs: number | null;
}

export function AuditionTrackHeader({ track, durationMs }: AuditionTrackHeaderProps) {
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
          <h2 title={track?.title}>{track?.title ?? 'Select a track'}</h2>
          <div className="audition-meta">
          <p className="audition-artist">{track ? track.artist ?? 'Artist Not Available' : 'Pick a track from the library below.'}</p>
          </div>
        </div>
      </div>
      {track && <div className="audition-track-details">
        <div className="audition-stat"><span>{track.bpm != null ? track.bpm.toFixed(0) : '—'}</span><small>Tempo</small></div>
        <div className="audition-stat"><span>{formatCamelotCode(track.musical_key) ?? '—'}</span><small>Key</small></div>
        <div className="audition-stat"><span title={track.genre ?? undefined}>{track.genre || '—'}</span><small>Genre</small></div>
      </div>}
      <div className="audition-duration"><span>{durationMs != null ? formatClock(durationMs) : '—:—'}</span><small>Track length</small></div>
    </section>
  );
}
