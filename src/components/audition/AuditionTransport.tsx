import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { logger } from '../../lib/logger';
import type { RekordboxTrack } from '../../types';
import { AuditionDecisions } from './AuditionDecisions';
import { AuditionTrackNavigation } from './AuditionTrackNavigation';

interface AuditionTransportProps {
  track: RekordboxTrack | null;
  /** "14 of 387", or null when the track is not in the current list. */
  positionLabel: string | null;
  /** Step to the track before or after the selected one in the list; null when there is none. */
  onStepPrevious: (() => void) | null;
  onStepNext: (() => void) | null;
}

export function AuditionTransport({ track, positionLabel, onStepPrevious, onStepNext }: AuditionTransportProps) {
  const { activeTrack, status, error } = useAudioPlayer();
  const playbackError = track?.id === activeTrack?.id && status === 'error' ? error : null;
  const lastLoggedError = useRef<string | null>(null);
  useEffect(() => {
    if (!playbackError || !track) {
      lastLoggedError.current = null;
      return;
    }
    if (lastLoggedError.current === playbackError) return;
    lastLoggedError.current = playbackError;
    logger.error('audition.playback.failed', { trackId: track.id, title: track.title, filePath: track.file_path, error: playbackError });
  }, [playbackError, track]);

  return (
    <div data-testid="audition-transport" role="group" aria-label="Audition decisions and navigation" className="audition-workflow-controls flex items-center justify-between gap-4">
      <AuditionDecisions />
      <AuditionTrackNavigation positionLabel={positionLabel} onPrevious={onStepPrevious} onNext={onStepNext} />
      {playbackError ? <p role="alert" className="text-xs text-red-300">{playbackError}</p> : null}
    </div>
  );
}
