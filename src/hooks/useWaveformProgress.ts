import { useEffect, useState } from 'react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';
import { computeProgress } from '../lib/rekordbox/waveformRenderer';

/**
 * Returns live playback progress [0, 1] for the given track ID.
 * Returns `undefined` when that track is not the active one — zero overhead for
 * inactive rows (no RAF loop, no state updates).
 *
 * - Playing: drives requestAnimationFrame at ~60fps for smooth playhead movement.
 * - Paused / ended: reads current position once and stops the RAF loop.
 * - Not active: immediately returns undefined; no RAF started.
 *
 * Only the component calling this hook re-renders on progress change — parent
 * components and sibling rows are not affected.
 */
export function useWaveformProgress(trackId: string | undefined): number | undefined {
  const { activeTrack, playIntent, getAudioElement } = useAudioPlayer();
  const [progress, setProgress] = useState<number | undefined>(undefined);

  const isActive = Boolean(trackId && activeTrack?.id === trackId);
  const isPlaying = isActive && playIntent;

  useEffect(() => {
    if (!isActive) {
      setProgress(undefined);
      return;
    }

    // Not playing (paused, ended, loading): show static current position once.
    if (!isPlaying) {
      const audio = getAudioElement();
      if (audio) setProgress(computeProgress(audio.currentTime, audio.duration));
      return;
    }

    // Playing: drive a RAF loop for smooth 60fps progress.
    let running = true;
    let rafId: number;

    function tick() {
      if (!running) return;
      const el = getAudioElement();
      if (el) setProgress(computeProgress(el.currentTime, el.duration));
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [isActive, isPlaying, getAudioElement]);

  return progress;
}
