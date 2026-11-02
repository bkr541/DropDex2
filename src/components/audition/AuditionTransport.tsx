import { useEffect, useRef } from 'react';
import { VolumeMute, VolumeUp } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { logger } from '../../lib/logger';
import { MediaTransportControlGroup, TransportButton } from '../ui/media';
import { formatClock } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionTransportProps {
  track: RekordboxTrack | null;
  /** Length from the library, used until the audio itself reports one. */
  fallbackDurationMs: number | null;
  previousTrack: RekordboxTrack | null;
  nextTrack: RekordboxTrack | null;
  onSelectTrack: (track: RekordboxTrack) => void;
}

const SKIP_SECONDS = 10;

export function AuditionTransport({ track, fallbackDurationMs, previousTrack, nextTrack, onSelectTrack }: AuditionTransportProps) {
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
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
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

      <div className="flex min-w-[220px] flex-1 items-center gap-2.5">
        <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatClock(currentSeconds * 1000)}
        </span>
        <input
          type="range"
          min={0}
          max={durationSeconds > 0 ? durationSeconds : 1}
          step={0.1}
          value={seekable ? Math.min(durationSeconds, Math.max(0, currentSeconds)) : 0}
          disabled={!seekable}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Playback position"
          className="h-1.5 min-w-[120px] flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {durationSeconds > 0 ? formatClock(durationSeconds * 1000) : '—'}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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

      {playbackError ? (
        <p role="alert" className="basis-full text-xs text-red-300">{playbackError}</p>
      ) : null}
    </div>
  );
}
