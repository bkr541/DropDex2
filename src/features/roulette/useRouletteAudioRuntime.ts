import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { registerUsbPlaybackStopHandler } from '../../lib/usb/usbPlaybackCoordinator';
import {
  createRouletteAudioRuntime,
  type RouletteAudioRuntime,
  type RouletteMixState,
  type RoulettePlaybackSources,
} from './rouletteAudioRuntime';
import type { RouletteSessionAction, RouletteSourceRole } from './rouletteSession';

export interface RoulettePlaybackUiState {
  status: 'idle' | 'loading' | 'playing' | 'error';
  error: string | null;
  progress: number;
  durationSeconds: number;
  waveforms: Record<RouletteSourceRole, number[]>;
  barFractions: number[];
  mix: RouletteMixState;
}

const DEFAULT_MIX: RouletteMixState = {
  vocal: { gain: 1, muted: false, solo: false },
  instrumental: { gain: 1, muted: false, solo: false },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useRouletteAudioRuntime({
  dispatch,
  getSources,
  createRuntime = createRouletteAudioRuntime,
}: {
  dispatch: (action: RouletteSessionAction) => void;
  getSources: () => RoulettePlaybackSources;
  createRuntime?: () => RouletteAudioRuntime;
}) {
  const globalPlayer = useAudioPlayer();
  const runtimeRef = useRef<RouletteAudioRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = createRuntime();
  const requestRef = useRef(0);
  const activePlayCommandRef = useRef<string | null>(null);
  const progressFrameRef = useRef(0);
  const [playback, setPlayback] = useState<RoulettePlaybackUiState>({
    status: 'idle',
    error: null,
    progress: 0,
    durationSeconds: 0,
    waveforms: { vocal: [], instrumental: [] },
    barFractions: [],
    mix: DEFAULT_MIX,
  });
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const cancelProgress = useCallback(() => {
    cancelAnimationFrame(progressFrameRef.current);
    progressFrameRef.current = 0;
  }, []);

  const stop = useCallback((options: { resetVisuals?: boolean } = {}) => {
    requestRef.current += 1;
    cancelProgress();
    runtimeRef.current?.stop();
    const activePlayCommand = activePlayCommandRef.current;
    if (activePlayCommand) {
      activePlayCommandRef.current = null;
      dispatch({ type: 'command-finished', command: 'play', requestId: activePlayCommand });
    }
    dispatch({
      type: 'transport-changed',
      status: 'stopped',
      masterBpm: options.resetVisuals ? null : undefined,
    });
    setPlayback((previous) => ({
      ...previous,
      status: 'idle',
      error: null,
      progress: 0,
      durationSeconds: options.resetVisuals ? 0 : previous.durationSeconds,
      waveforms: options.resetVisuals ? { vocal: [], instrumental: [] } : previous.waveforms,
      barFractions: options.resetVisuals ? [] : previous.barFractions,
    }));
  }, [cancelProgress, dispatch]);

  const play = useCallback(async (): Promise<boolean> => {
    const requestId = ++requestRef.current;
    const sources = getSources();
    const commandRequestId = `roulette-play-${requestId}`;
    activePlayCommandRef.current = commandRequestId;
    dispatch({ type: 'command-started', command: 'play', requestId: commandRequestId });
    setPlayback((previous) => ({ ...previous, status: 'loading', error: null, progress: 0 }));

    // Existing DropDex convention: feature previews stop the single-track player
    // before taking Web Audio output ownership.
    globalPlayer.stop();

    try {
      const result = await runtimeRef.current!.play(sources, playbackRef.current.mix, () => {
        if (requestId !== requestRef.current) return;
        cancelProgress();
        dispatch({ type: 'transport-changed', status: 'stopped' });
        setPlayback((previous) => ({ ...previous, status: 'idle', progress: 0 }));
      });
      if (requestId !== requestRef.current) return false;

      dispatch({
        type: 'transport-changed',
        status: 'playing',
        masterBpm: result.masterBpm,
      });
      activePlayCommandRef.current = null;
      dispatch({ type: 'command-finished', command: 'play', requestId: commandRequestId });
      setPlayback((previous) => ({
        ...previous,
        status: 'playing',
        error: null,
        progress: 0,
        durationSeconds: result.durationSeconds,
        waveforms: result.waveforms,
        barFractions: result.barFractions,
      }));

      let lastUiUpdate = 0;
      const updateProgress = (timestamp: number) => {
        if (requestId !== requestRef.current) return;
        const runtime = runtimeRef.current;
        if (!runtime) return;
        const duration = runtime.getDurationSeconds();
        const position = runtime.getPositionSeconds();
        if (timestamp - lastUiUpdate >= 50) {
          lastUiUpdate = timestamp;
          setPlayback((previous) => ({
            ...previous,
            progress: duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0,
          }));
        }
        if (duration > 0 && position < duration) {
          progressFrameRef.current = requestAnimationFrame(updateProgress);
        }
      };
      progressFrameRef.current = requestAnimationFrame(updateProgress);
      return true;
    } catch (error) {
      if (requestId !== requestRef.current) return false;
      if (isAbortError(error)) {
        activePlayCommandRef.current = null;
        dispatch({ type: 'command-finished', command: 'play', requestId: commandRequestId });
        setPlayback((previous) => ({ ...previous, status: 'idle', error: null, progress: 0 }));
        return false;
      }
      const message = errorMessage(error);
      activePlayCommandRef.current = null;
      dispatch({ type: 'command-failed', command: 'play', requestId: commandRequestId, error: message });
      dispatch({ type: 'transport-changed', status: 'stopped' });
      setPlayback((previous) => ({ ...previous, status: 'error', error: message, progress: 0 }));
      return false;
    }
  }, [cancelProgress, dispatch, getSources, globalPlayer]);

  const setDeckGain = useCallback((role: RouletteSourceRole, gain: number) => {
    setPlayback((previous) => {
      const mix: RouletteMixState = {
        ...previous.mix,
        [role]: { ...previous.mix[role], gain: Math.max(0, Math.min(1, gain)) },
      };
      runtimeRef.current?.setMix(mix);
      return { ...previous, mix };
    });
  }, []);

  const toggleDeckMute = useCallback((role: RouletteSourceRole) => {
    setPlayback((previous) => {
      const mix: RouletteMixState = {
        ...previous.mix,
        [role]: { ...previous.mix[role], muted: !previous.mix[role].muted },
      };
      runtimeRef.current?.setMix(mix);
      return { ...previous, mix };
    });
  }, []);

  const toggleDeckSolo = useCallback((role: RouletteSourceRole) => {
    setPlayback((previous) => {
      const mix: RouletteMixState = {
        ...previous.mix,
        [role]: { ...previous.mix[role], solo: !previous.mix[role].solo },
      };
      runtimeRef.current?.setMix(mix);
      return { ...previous, mix };
    });
  }, []);

  useEffect(() => registerUsbPlaybackStopHandler(() => {
    stop({ resetVisuals: true });
    runtimeRef.current?.clearCache();
  }), [stop]);

  useEffect(() => () => {
    requestRef.current += 1;
    cancelProgress();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    void runtime?.dispose();
  }, [cancelProgress]);

  return useMemo(() => ({
    playback,
    play,
    stop,
    setDeckGain,
    toggleDeckMute,
    toggleDeckSolo,
  }), [play, playback, setDeckGain, stop, toggleDeckMute, toggleDeckSolo]);
}
