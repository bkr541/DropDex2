import { useCallback } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { TrackListingWaveform, type TrackListingCue } from '../ui/display';
import type { RekordboxTrack } from '../../types';
import { durationMsForTrack } from '../../lib/music/trackTiming';

/** A listing row's waveform that also follows playback: it fills as the track plays, and a click seeks when this is the track playing. */
export function TrackRowWaveform({
  track, waveformState, onRetry, cues, height = 18,
}: {
  track: RekordboxTrack;
  waveformState: WaveformLoadState;
  onRetry?: () => void;
  cues?: readonly TrackListingCue[];
  height?: number;
}) {
  const progress = useWaveformProgress(track.id);
  const { activeTrack, status, seek, getAudioElement } = useAudioPlayer();
  const canSeek = activeTrack?.id === track.id && !['idle', 'resolving', 'loading', 'error'].includes(status);
  const handleSeek = useCallback((fraction: number) => {
    const audio = getAudioElement();
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seek(fraction * audio.duration);
  }, [seek, getAudioElement]);

  return (
    <TrackListingWaveform
      waveformState={waveformState}
      durationMs={durationMsForTrack(track, null)}
      cues={cues}
      height={height}
      ariaLabel={`Waveform for ${track.title}`}
      onRetry={onRetry}
      activeProgress={progress}
      onSeek={canSeek ? handleSeek : undefined}
    />
  );
}
