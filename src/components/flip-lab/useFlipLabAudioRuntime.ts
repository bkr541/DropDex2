import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { registerUsbPlaybackStopHandler } from '../../lib/usb/usbPlaybackCoordinator';
import {
  createRouletteAudioRuntime,
  type RouletteAudioRuntime,
  type RouletteCompatibilitySummary,
  type RouletteMixState,
  type RoulettePlaybackResult,
  type RoulettePlaybackSources,
} from '../../features/roulette/rouletteAudioRuntime';
import { roulettePreparedAssetRef, type RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import { resolveRouletteTempoPlan } from '../../features/roulette/rouletteTempoSync';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import type { RekordboxTrack } from '../../types';
import { isFlipLabStemUsable, type FlipLabStemRoleState } from './flipLabStemLifecycle';

export type FlipLabPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface FlipLabPlaybackState {
  status: FlipLabPlaybackStatus;
  error: string | null;
  positionSeconds: number;
  durationSeconds: number;
  result: RoulettePlaybackResult | null;
  syncEnabled: boolean;
}

const DEFAULT_FLIP_LAB_MIX: RouletteMixState = {
  vocal: { gain: 0.85, muted: false, solo: false },
  instrumental: { gain: 0.85, muted: false, solo: false },
};

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveFlipLabPlaybackSources(
  vocalState: FlipLabStemRoleState,
  instrumentalState: FlipLabStemRoleState,
  vocalTrackId: string | null | undefined,
  instrumentalTrackId: string | null | undefined,
): RoulettePlaybackSources | null {
  if (
    !isFlipLabStemUsable(vocalState, vocalTrackId)
    || !isFlipLabStemUsable(instrumentalState, instrumentalTrackId)
    || !vocalState.asset
    || !instrumentalState.asset
    || !vocalState.window
    || !instrumentalState.window
  ) return null;

  return {
    vocal: {
      parentTrackId: vocalTrackId!,
      stemRef: roulettePreparedAssetRef(vocalState.asset),
      stemStatus: 'ready',
      window: vocalState.window,
    },
    instrumental: {
      parentTrackId: instrumentalTrackId!,
      stemRef: roulettePreparedAssetRef(instrumentalState.asset),
      stemStatus: 'ready',
      window: instrumentalState.window,
    },
  };
}

export function resolveFlipLabMasterBpm(
  vocalBpm: number | null | undefined,
  instrumentalBpm: number | null | undefined,
  syncEnabled: boolean,
): number | null {
  if (!finitePositive(vocalBpm) || !finitePositive(instrumentalBpm)) return null;
  try {
    return resolveRouletteTempoPlan(vocalBpm, instrumentalBpm, { syncEnabled }).masterBpm;
  } catch {
    return null;
  }
}

export function flipLabBarDurationSeconds(masterBpm: number | null | undefined): number | null {
  return finitePositive(masterBpm) ? 240 / masterBpm : null;
}

export function resolveFlipLabPlayheadPercent({
  role,
  positionSeconds,
  durationSeconds,
  trackDurationMs,
  window,
  compatibility,
  syncEnabled,
}: {
  role: RouletteSourceRole;
  positionSeconds: number;
  durationSeconds: number;
  trackDurationMs: number | null;
  window: RoulettePreviewWindow | null;
  compatibility: RouletteCompatibilitySummary | null;
  syncEnabled: boolean;
}): number {
  const sessionProgress = durationSeconds > 0
    ? Math.max(0, Math.min(1, positionSeconds / durationSeconds))
    : 0;
  if (!window || !trackDurationMs || trackDurationMs <= 0) return sessionProgress * 100;

  const sourceBpm = compatibility?.originalBpm[role];
  const masterBpm = compatibility?.masterBpm;
  const sourceAdvanceRatio = syncEnabled && finitePositive(sourceBpm) && finitePositive(masterBpm)
    ? masterBpm / sourceBpm
    : 1;
  const sourceTimeMs = window.sourceTimeMs + Math.max(0, positionSeconds) * sourceAdvanceRatio * 1000;
  return Math.max(0, Math.min(100, (sourceTimeMs / trackDurationMs) * 100));
}

function initialState(syncEnabled = true): FlipLabPlaybackState {
  return {
    status: 'idle',
    error: null,
    positionSeconds: 0,
    durationSeconds: 0,
    result: null,
    syncEnabled,
  };
}

export function useFlipLabAudioRuntime({
  vocalTrack,
  instrumentalTrack,
  vocalStemState,
  instrumentalStemState,
  pairCompatible,
  createRuntime = createRouletteAudioRuntime,
}: {
  vocalTrack: RekordboxTrack | null;
  instrumentalTrack: RekordboxTrack | null;
  vocalStemState: FlipLabStemRoleState;
  instrumentalStemState: FlipLabStemRoleState;
  pairCompatible: boolean;
  createRuntime?: () => RouletteAudioRuntime;
}) {
  const globalPlayer = useAudioPlayer();
  const runtimeRef = useRef<RouletteAudioRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = createRuntime();
  const requestRef = useRef(0);
  const progressFrameRef = useRef(0);
  const sourceKeyRef = useRef<string | null>(null);
  const [playback, setPlayback] = useState<FlipLabPlaybackState>(() => initialState());
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const sources = useMemo(() => resolveFlipLabPlaybackSources(
    vocalStemState,
    instrumentalStemState,
    vocalTrack?.id,
    instrumentalTrack?.id,
  ), [instrumentalStemState, instrumentalTrack?.id, vocalStemState, vocalTrack?.id]);

  const sourceKey = sources
    ? `${sources.vocal.parentTrackId}:${sources.vocal.stemRef}|${sources.instrumental.parentTrackId}:${sources.instrumental.stemRef}`
    : null;

  const plannedMasterBpm = useMemo(() => resolveFlipLabMasterBpm(
    vocalTrack?.bpm,
    instrumentalTrack?.bpm,
    playback.syncEnabled,
  ), [instrumentalTrack?.bpm, playback.syncEnabled, vocalTrack?.bpm]);

  const masterBpm = playback.result?.masterBpm ?? plannedMasterBpm;
  const ready = pairCompatible && sources !== null;

  const cancelProgress = useCallback(() => {
    cancelAnimationFrame(progressFrameRef.current);
    progressFrameRef.current = 0;
  }, []);

  const startProgress = useCallback((requestId: number) => {
    cancelProgress();
    let lastUiUpdate = 0;
    const update = (timestamp: number) => {
      if (requestId !== requestRef.current) return;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (timestamp - lastUiUpdate >= 40) {
        lastUiUpdate = timestamp;
        const positionSeconds = runtime.getPositionSeconds();
        const durationSeconds = runtime.getDurationSeconds();
        setPlayback((current) => ({ ...current, positionSeconds, durationSeconds }));
      }
      if (runtime.isPlaying()) progressFrameRef.current = requestAnimationFrame(update);
    };
    progressFrameRef.current = requestAnimationFrame(update);
  }, [cancelProgress]);

  const stop = useCallback((options: { clearResult?: boolean } = {}) => {
    requestRef.current += 1;
    cancelProgress();
    runtimeRef.current?.stop();
    setPlayback((current) => ({
      ...current,
      status: 'idle',
      error: null,
      positionSeconds: 0,
      durationSeconds: options.clearResult ? 0 : current.durationSeconds,
      result: options.clearResult ? null : current.result,
    }));
  }, [cancelProgress]);

  const playFromStart = useCallback(async (): Promise<boolean> => {
    const currentSources = sources;
    if (!pairCompatible || !currentSources) {
      setPlayback((current) => ({
        ...current,
        status: 'error',
        error: 'Both prepared role stems must be ready before Flip Lab can play.',
      }));
      return false;
    }

    const requestId = ++requestRef.current;
    cancelProgress();
    setPlayback((current) => ({ ...current, status: 'loading', error: null, positionSeconds: 0 }));
    globalPlayer.stop();

    try {
      const result = await runtimeRef.current!.play(
        currentSources,
        DEFAULT_FLIP_LAB_MIX,
        () => {
          if (requestId !== requestRef.current) return;
          cancelProgress();
          runtimeRef.current?.seek(0);
          setPlayback((current) => ({ ...current, status: 'idle', positionSeconds: 0 }));
        },
        { tempoSyncEnabled: playbackRef.current.syncEnabled },
      );
      if (requestId !== requestRef.current) return false;
      setPlayback((current) => ({
        ...current,
        status: 'playing',
        error: null,
        positionSeconds: 0,
        durationSeconds: result.durationSeconds,
        result,
      }));
      startProgress(requestId);
      return true;
    } catch (error) {
      if (requestId !== requestRef.current) return false;
      runtimeRef.current?.stop();
      setPlayback((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Flip Lab playback could not start.',
        positionSeconds: 0,
        durationSeconds: 0,
        result: null,
      }));
      return false;
    }
  }, [cancelProgress, globalPlayer, pairCompatible, sources, startProgress]);

  const togglePlayPause = useCallback(async (): Promise<boolean> => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    const current = playbackRef.current;
    if (current.status === 'playing') {
      cancelProgress();
      const positionSeconds = runtime.pause();
      setPlayback((state) => ({ ...state, status: 'paused', positionSeconds }));
      return true;
    }
    if (current.status === 'paused') {
      if (!runtime.resume()) return playFromStart();
      const requestId = requestRef.current;
      setPlayback((state) => ({ ...state, status: 'playing', error: null }));
      startProgress(requestId);
      return true;
    }
    return playFromStart();
  }, [cancelProgress, playFromStart, startProgress]);

  const seekTo = useCallback((positionSeconds: number) => {
    const runtime = runtimeRef.current;
    if (!runtime || playbackRef.current.durationSeconds <= 0) return;
    const next = runtime.seek(positionSeconds);
    const runtimePlaying = runtime.isPlaying();
    setPlayback((current) => ({
      ...current,
      positionSeconds: next,
      status: current.status === 'playing' && !runtimePlaying ? 'paused' : current.status,
    }));
  }, []);

  const seekByBars = useCallback((bars: number) => {
    const barSeconds = flipLabBarDurationSeconds(masterBpm);
    if (!barSeconds) return;
    seekTo(playbackRef.current.positionSeconds + bars * barSeconds);
  }, [masterBpm, seekTo]);

  const seekToStart = useCallback(() => seekTo(0), [seekTo]);
  const seekToEnd = useCallback(() => seekTo(playbackRef.current.durationSeconds), [seekTo]);

  const toggleSync = useCallback(() => {
    requestRef.current += 1;
    cancelProgress();
    runtimeRef.current?.stop();
    setPlayback((current) => initialState(!current.syncEnabled));
  }, [cancelProgress]);

  useEffect(() => {
    const previousKey = sourceKeyRef.current;
    sourceKeyRef.current = sourceKey;
    if (previousKey !== null && previousKey !== sourceKey) stop({ clearResult: true });
  }, [sourceKey, stop]);

  useEffect(() => registerUsbPlaybackStopHandler(() => stop({ clearResult: true })), [stop]);

  useEffect(() => () => {
    requestRef.current += 1;
    cancelProgress();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    void runtime?.dispose();
  }, [cancelProgress]);

  return useMemo(() => ({
    playback,
    masterBpm,
    ready,
    togglePlayPause,
    stop,
    seekByBars,
    seekToStart,
    seekToEnd,
    toggleSync,
  }), [masterBpm, playback, ready, seekByBars, seekToEnd, seekToStart, stop, togglePlayPause, toggleSync]);
}
