import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { registerUsbPlaybackStopHandler } from '../../lib/usb/usbPlaybackCoordinator';
import {
  createRouletteAudioRuntime,
  type RouletteAudioRuntime,
  type RouletteCompatibilitySummary,
  type RouletteDeckEq,
  type RouletteEqBand,
  type RouletteEqState,
  type RouletteMixState,
  type RoulettePlaybackResult,
  type RoulettePlaybackSources,
} from '../../features/roulette/rouletteAudioRuntime';
import { roulettePreparedAssetRef, type RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import { roulettePreviewPreparationService } from '../../features/roulette/roulettePreviewPreparationService';
import { resolveRouletteTempoPlan } from '../../features/roulette/rouletteTempoSync';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import type { RekordboxTrack } from '../../types';
import { isFlipLabStemUsable, type FlipLabStemRoleState } from './flipLabStemLifecycle';

export type FlipLabPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type FlipLabLoopBars = 4 | 8 | 16 | 32 | 'off';

export interface FlipLabPlaybackState {
  status: FlipLabPlaybackStatus;
  error: string | null;
  positionSeconds: number;
  durationSeconds: number;
  result: RoulettePlaybackResult | null;
  syncEnabled: boolean;
}

export interface FlipLabPreparedVisualizationState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: RoulettePlaybackResult | null;
  error: string | null;
}

export interface FlipLabCandidatePreviewState {
  role: RouletteSourceRole | null;
  trackId: string | null;
  status: 'idle' | 'loading' | 'playing' | 'error';
  error: string | null;
}

export const DEFAULT_FLIP_LAB_EQ: RouletteEqState = {
  vocal: { low: 0, mid: 0, high: 0 },
  instrumental: { low: 0, mid: 0, high: 0 },
};

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

export function resolveFlipLabEqualPowerMix(position: number): RouletteMixState {
  const normalized = clamp01(position);
  return {
    vocal: {
      gain: Math.cos(normalized * Math.PI / 2),
      muted: false,
      solo: false,
    },
    instrumental: {
      gain: Math.sin(normalized * Math.PI / 2),
      muted: false,
      solo: false,
    },
  };
}

export function clampFlipLabEqDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-12, Math.min(12, Math.round(value * 2) / 2));
}

export function formatFlipLabEqDb(value: number): string {
  const normalized = clampFlipLabEqDb(value);
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)} dB`;
}

export function resolveFlipLabLoopEndSeconds(
  result: Pick<RoulettePlaybackResult, 'durationSeconds' | 'masterBpm'> | null,
  loopBars: FlipLabLoopBars,
): number | null {
  if (!result || loopBars === 'off' || !finitePositive(result.masterBpm) || !finitePositive(result.durationSeconds)) return null;
  const end = loopBars * (240 / result.masterBpm);
  // Rekordbox's stored beat timestamps can differ slightly from nominal BPM. Allow
  // sub-beat drift, then clamp to the exact prepared window so a complete 16-bar
  // audition remains a legal 16-bar loop without ever running past its media.
  return end <= result.durationSeconds + 0.25 ? Math.min(end, result.durationSeconds) : null;
}

export function availableFlipLabLoopBars(
  result: Pick<RoulettePlaybackResult, 'durationSeconds' | 'masterBpm'> | null,
): FlipLabLoopBars[] {
  const values = ([4, 8, 16, 32] as const).filter((bars) => resolveFlipLabLoopEndSeconds(result, bars) != null);
  return [...values, 'off'];
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

export function resolveFlipLabPreparedPlayheadPercent(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!finitePositive(durationSeconds)) return 0;
  return Math.max(0, Math.min(100, (Math.max(0, positionSeconds) / durationSeconds) * 100));
}

/** Retained for parent-timeline consumers outside the prepared-stem waveform viewport. */
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

const INITIAL_PREVIEW_STATE: FlipLabCandidatePreviewState = {
  role: null,
  trackId: null,
  status: 'idle',
  error: null,
};

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Prepared candidate preview could not be loaded.')); };
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}

function releaseCandidateAudio(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.ontimeupdate = null;
  audio.onended = null;
  audio.pause();
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* browser teardown */ }
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
  const previewRequestRef = useRef(0);
  const progressFrameRef = useRef(0);
  const sourceKeyRef = useRef<string | null>(null);
  const preflightAbortRef = useRef<AbortController | null>(null);
  const preflightPromiseRef = useRef<Promise<void> | null>(null);
  const candidateAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playback, setPlayback] = useState<FlipLabPlaybackState>(() => initialState());
  const [visualization, setVisualization] = useState<FlipLabPreparedVisualizationState>({ status: 'idle', result: null, error: null });
  const [candidatePreview, setCandidatePreview] = useState<FlipLabCandidatePreviewState>(INITIAL_PREVIEW_STATE);
  const [eq, setEqState] = useState<RouletteEqState>(() => ({
    vocal: { ...DEFAULT_FLIP_LAB_EQ.vocal },
    instrumental: { ...DEFAULT_FLIP_LAB_EQ.instrumental },
  }));
  const [mixPosition, setMixPositionState] = useState(0.5);
  const [loopBars, setLoopBars] = useState<FlipLabLoopBars>(16);
  const playbackRef = useRef(playback);
  const eqRef = useRef(eq);
  const mixRef = useRef(resolveFlipLabEqualPowerMix(mixPosition));
  const loopBarsRef = useRef(loopBars);
  playbackRef.current = playback;
  eqRef.current = eq;
  mixRef.current = resolveFlipLabEqualPowerMix(mixPosition);
  loopBarsRef.current = loopBars;

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

  const visualResult = playback.result ?? visualization.result;
  const masterBpm = visualResult?.masterBpm ?? plannedMasterBpm;
  const ready = pairCompatible && sources !== null;
  const mix = useMemo(() => resolveFlipLabEqualPowerMix(mixPosition), [mixPosition]);
  const loopOptions = useMemo(() => availableFlipLabLoopBars(visualResult), [visualResult]);

  const cancelProgress = useCallback(() => {
    cancelAnimationFrame(progressFrameRef.current);
    progressFrameRef.current = 0;
  }, []);

  const stopCandidatePreview = useCallback(() => {
    previewRequestRef.current += 1;
    const audio = candidateAudioRef.current;
    candidateAudioRef.current = null;
    releaseCandidateAudio(audio);
    setCandidatePreview(INITIAL_PREVIEW_STATE);
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
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    cancelProgress();
    runtimeRef.current?.stop();
    stopCandidatePreview();
    setPlayback((current) => ({
      ...current,
      status: 'idle',
      error: null,
      positionSeconds: 0,
      durationSeconds: options.clearResult ? 0 : current.durationSeconds,
      result: options.clearResult ? null : current.result,
    }));
  }, [cancelProgress, stopCandidatePreview]);

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

    const pendingPreflight = preflightPromiseRef.current;
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    if (pendingPreflight) await pendingPreflight;
    stopCandidatePreview();
    const requestId = ++requestRef.current;
    cancelProgress();
    setPlayback((current) => ({ ...current, status: 'loading', error: null, positionSeconds: 0 }));
    globalPlayer.stop();

    try {
      const result = await runtimeRef.current!.play(
        currentSources,
        mixRef.current,
        () => {
          if (requestId !== requestRef.current) return;
          cancelProgress();
          runtimeRef.current?.seek(0);
          setPlayback((current) => ({ ...current, status: 'idle', positionSeconds: 0 }));
        },
        { tempoSyncEnabled: playbackRef.current.syncEnabled },
      );
      if (requestId !== requestRef.current) return false;
      runtimeRef.current?.setEq(eqRef.current);
      runtimeRef.current?.setLoopEndSeconds(resolveFlipLabLoopEndSeconds(result, loopBarsRef.current));
      setPlayback((current) => ({
        ...current,
        status: 'playing',
        error: null,
        positionSeconds: 0,
        durationSeconds: result.durationSeconds,
        result,
      }));
      setVisualization({ status: 'ready', result, error: null });
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
  }, [cancelProgress, globalPlayer, pairCompatible, sources, startProgress, stopCandidatePreview]);

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
      stopCandidatePreview();
      if (!runtime.resume()) return playFromStart();
      const requestId = requestRef.current;
      setPlayback((state) => ({ ...state, status: 'playing', error: null }));
      startProgress(requestId);
      return true;
    }
    return playFromStart();
  }, [cancelProgress, playFromStart, startProgress, stopCandidatePreview]);

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
  const seekToEnd = useCallback(() => {
    const activeResult = playbackRef.current.result ?? visualization.result;
    const loopEnd = resolveFlipLabLoopEndSeconds(activeResult, loopBarsRef.current);
    seekTo(loopEnd ?? playbackRef.current.durationSeconds);
  }, [seekTo, visualization.result]);

  const setEqBand = useCallback((role: RouletteSourceRole, band: RouletteEqBand, value: number) => {
    setEqState((current) => ({
      ...current,
      [role]: { ...current[role], [band]: clampFlipLabEqDb(value) } as RouletteDeckEq,
    }));
  }, []);

  const setMixPosition = useCallback((value: number) => setMixPositionState(clamp01(value)), []);

  const toggleCandidatePreview = useCallback(async (role: RouletteSourceRole, track: RekordboxTrack): Promise<void> => {
    if (candidatePreview.status === 'playing' && candidatePreview.role === role && candidatePreview.trackId === track.id) {
      stopCandidatePreview();
      return;
    }

    stop({ clearResult: false });
    globalPlayer.stop();
    const requestId = ++previewRequestRef.current;
    setCandidatePreview({ role, trackId: track.id, status: 'loading', error: null });

    try {
      const prepared = await roulettePreviewPreparationService.prepare(track, role);
      if (requestId !== previewRequestRef.current) return;
      if (prepared.status !== 'ready' || !prepared.asset || !prepared.window) {
        throw new Error(prepared.message ?? 'Prepared role preview is not ready yet.');
      }
      const resolved = await roulettePreviewPreparationService.resolvePreparedAsset(prepared.asset);
      if (requestId !== previewRequestRef.current) return;
      if (!resolved) throw new Error('Prepared role preview is unavailable on this device.');

      const audio = new Audio(resolved.source.url);
      candidateAudioRef.current = audio;
      await waitForAudioMetadata(audio);
      if (requestId !== previewRequestRef.current) return;
      const startSeconds = Math.max(0, resolved.mediaStartMs / 1000);
      const endSeconds = startSeconds + Math.max(0.1, resolved.window.durationMs / 1000);
      audio.currentTime = startSeconds;
      audio.volume = 0.9;
      audio.ontimeupdate = () => {
        if (audio.currentTime >= endSeconds) stopCandidatePreview();
      };
      audio.onended = stopCandidatePreview;
      await audio.play();
      if (requestId !== previewRequestRef.current) {
        audio.pause();
        return;
      }
      setCandidatePreview({ role, trackId: track.id, status: 'playing', error: null });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      const audio = candidateAudioRef.current;
      candidateAudioRef.current = null;
      releaseCandidateAudio(audio);
      setCandidatePreview({
        role,
        trackId: track.id,
        status: 'error',
        error: error instanceof Error ? error.message : 'Candidate preview could not start.',
      });
    }
  }, [candidatePreview.role, candidatePreview.status, candidatePreview.trackId, globalPlayer, stop, stopCandidatePreview]);

  const toggleSync = useCallback(() => {
    requestRef.current += 1;
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    cancelProgress();
    runtimeRef.current?.stop();
    stopCandidatePreview();
    setPlayback((current) => initialState(!current.syncEnabled));
  }, [cancelProgress, stopCandidatePreview]);

  useEffect(() => {
    runtimeRef.current?.setEq(eq);
  }, [eq]);

  useEffect(() => {
    runtimeRef.current?.setMix(mix);
  }, [mix]);

  useEffect(() => {
    const activeResult = playback.result ?? visualization.result;
    runtimeRef.current?.setLoopEndSeconds(resolveFlipLabLoopEndSeconds(activeResult, loopBars));
  }, [loopBars, playback.result, visualization.result]);

  useEffect(() => {
    const previousKey = sourceKeyRef.current;
    sourceKeyRef.current = sourceKey;
    if (previousKey !== null && previousKey !== sourceKey) stop({ clearResult: true });
  }, [sourceKey, stop]);

  useEffect(() => {
    if (!ready || !sources || !sourceKey) {
      preflightAbortRef.current?.abort();
      setVisualization({ status: 'idle', result: null, error: null });
      return;
    }

    const previousController = preflightAbortRef.current;
    const previousPromise = preflightPromiseRef.current;
    previousController?.abort();
    const controller = new AbortController();
    preflightAbortRef.current = controller;

    const task = (async () => {
      if (previousPromise) await previousPromise;
      if (controller.signal.aborted) return;
      setVisualization((current) => ({ status: 'loading', result: current.result, error: null }));
      try {
        const result = await runtimeRef.current!.prepare(
          sources,
          controller.signal,
          { tempoSyncEnabled: playbackRef.current.syncEnabled },
        );
        if (!controller.signal.aborted) setVisualization({ status: 'ready', result, error: null });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        setVisualization({
          status: 'error',
          result: null,
          error: error instanceof Error ? error.message : 'Prepared stem waveform could not be loaded.',
        });
      } finally {
        if (preflightAbortRef.current === controller) preflightAbortRef.current = null;
      }
    })();
    preflightPromiseRef.current = task;
    void task.finally(() => {
      if (preflightPromiseRef.current === task) preflightPromiseRef.current = null;
    });
    return () => controller.abort();
  }, [ready, sourceKey, sources, playback.syncEnabled]);

  useEffect(() => registerUsbPlaybackStopHandler(() => stop({ clearResult: true })), [stop]);

  useEffect(() => () => {
    requestRef.current += 1;
    previewRequestRef.current += 1;
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    cancelProgress();
    const audio = candidateAudioRef.current;
    candidateAudioRef.current = null;
    releaseCandidateAudio(audio);
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    void runtime?.dispose();
  }, [cancelProgress]);

  return useMemo(() => ({
    playback,
    visualization,
    visualResult,
    candidatePreview,
    eq,
    mixPosition,
    mix,
    loopBars,
    loopOptions,
    masterBpm,
    ready,
    togglePlayPause,
    toggleCandidatePreview,
    stopCandidatePreview,
    stop,
    seekByBars,
    seekToStart,
    seekToEnd,
    toggleSync,
    setEqBand,
    setMixPosition,
    setLoopBars,
  }), [
    candidatePreview,
    eq,
    loopBars,
    loopOptions,
    masterBpm,
    mix,
    mixPosition,
    playback,
    ready,
    seekByBars,
    seekToEnd,
    seekToStart,
    stop,
    stopCandidatePreview,
    toggleCandidatePreview,
    togglePlayPause,
    toggleSync,
    setEqBand,
    setMixPosition,
    visualResult,
    visualization,
  ]);
}
