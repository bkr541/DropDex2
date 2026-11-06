import { useEffect, useRef } from 'react';
import { VolumeMute, VolumeUp } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { logger } from '../../lib/logger';
import { MediaTransportControlGroup, PlaybackSeekBar, TransportButton } from '../ui/media';
import type { RekordboxTrack } from '../../types';
import { AuditionDecisions } from './AuditionDecisions';
import { AuditionTrackNavigation } from './AuditionTrackNavigation';

interface AuditionTransportProps {
  track: RekordboxTrack | null;
  /** Length from the library, used until the audio itself reports one. */
  fallbackDurationMs: number | null;
  previousTrack: RekordboxTrack | null;
  nextTrack: RekordboxTrack | null;
  onSelectTrack: (track: RekordboxTrack) => void;
  /** "14 of 387", or null when the track is not in the current list. */
  positionLabel: string | null;
  /** Step to the track before or after the selected one in the list; null when there is none. */
  onStepPrevious: (() => void) | null;
  onStepNext: (() => void) | null;
}

const SKIP_SECONDS = 10;

export function AuditionTransport({ track, fallbackDurationMs, previousTrack, nextTrack, onSelectTrack, positionLabel, onStepPrevious, onStepNext }: AuditionTransportProps) {
  const {
    activeTrack, status, playIntent, volume, muted, error,
    playTrack, toggleTrack, seek, setVolume, toggleMute, getAudioElement,
  } = useAudioPlayer();
  // Re-renders this row as playback moves; the value itself is read from the audio element.
  useWaveformProgress(track?.id);

  const isActive = Boolean(track && activeTrack?.id === track.id);
  const playing = isActive && playIntent && status !== 'error';
  const loading = isActive && (status === 'resolving' || status === 'loading');
  const audio = isActive ? getAudioElement() : null;
  const audioDuration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const durationSeconds = audioDuration > 0 ? audioDuration : (fallbackDurationMs ?? 0) / 1000;
  const currentSeconds = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const seekable = isActive && audioDuration > 0 && !loading && status !== 'error';
  const playbackError = isActive && status === 'error' ? error : null;

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

  function handleTogglePlay() {
    if (!track || loading) return;
    logger.info('audition.playback.toggle', { trackId: track.id, title: track.title, action: playing ? 'pause' : 'play' });
    void toggleTrack(track);
  }

  function skipTo(destination: RekordboxTrack | null) {
    if (!destination) return;
    onSelectTrack(destination);
    void playTrack(destination);
  }

  function skipBy(deltaSeconds: number) {
    if (!seekable) return;
    seek(Math.min(durationSeconds, Math.max(0, currentSeconds + deltaSeconds)));
  }

  return (
    <div
      data-testid="audition-transport"
      role="region"
      aria-label="Audition playback"
      className="audition-transport"
    >
      <MediaTransportControlGroup
        compact
        ariaLabel="Audition transport controls"
        playing={playing}
        onPrevious={() => skipTo(previousTrack)}
        onRewind={() => skipBy(-SKIP_SECONDS)}
        onTogglePlay={handleTogglePlay}
        onForward={() => skipBy(SKIP_SECONDS)}
        onNext={() => skipTo(nextTrack)}
        previousDisabled={!previousTrack}
        rewindDisabled={!seekable}
        playDisabled={!track || loading}
        forwardDisabled={!seekable}
        nextDisabled={!nextTrack}
      />

      <PlaybackSeekBar
        className="audition-seek min-w-[220px]"
        currentSeconds={currentSeconds}
        durationSeconds={durationSeconds}
        seekable={seekable}
        onSeek={seek}
        ariaLabel="Playback position"
      />

      <div className="audition-volume flex shrink-0 items-center gap-2">
        <TransportButton label={muted ? 'Unmute' : 'Mute'} tone="mute" size="compact" active={muted} onClick={toggleMute}>
          {muted || volume === 0 ? <VolumeMute size={16} /> : <VolumeUp size={16} />}
        </TransportButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1.5 w-24 cursor-pointer accent-primary"
        />
      </div>

      <AuditionDecisions />

      <AuditionTrackNavigation positionLabel={positionLabel} onPrevious={onStepPrevious} onNext={onStepNext} />

      {playbackError ? (
        <p role="alert" className="basis-full text-xs text-red-300">{playbackError}</p>
      ) : null}
    </div>
  );
}
