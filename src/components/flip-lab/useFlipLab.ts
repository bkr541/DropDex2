import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { createRouletteTimeStretchProcessor } from '../../features/roulette/rouletteTimeStretch';
import { FlipLabEngine } from './flipLabEngine';
import {
  FLIP_LAB_MAX_BPM_DIFFERENCE,
  computeFlipLabTimeline,
  flipLabBpmDifference,
  flipLabKeyShiftSemitones,
  type FlipLabTimeline,
} from './flipLabTimeline';
import {
  cancelFlipLabSeparation,
  loadFlipLabStemAudio,
  separateFlipLabPair,
} from './flipLabSeparation';
import { resolveFlipLabCamelotKey, trackDurationMs } from './flipLabAnalysis';

export type FlipLabPhase = 'idle' | 'separating' | 'preparing' | 'ready' | 'error';

export interface FlipLabPairInput {
  vocal: RekordboxTrack;
  instrumental: RekordboxTrack;
  vocalBeatGrid: BeatGridRow | null;
  instrumentalBeatGrid: BeatGridRow | null;
}

export interface FlipLabState {
  phase: FlipLabPhase;
  /** 0..1 combined separation progress */
  progress: number;
  loadedPair: { vocalId: string; instrumentalId: string } | null;
  timeline: FlipLabTimeline | null;
  errors: string[];
  warnings: string[];
  playing: boolean;
  positionSec: number;
  volume: number;
  keyShift: boolean;
  /** Semitones applied to the vocal when key shift is on; null when keys are unknown. */
  keyShiftSemitones: number | null;
}

const INITIAL: FlipLabState = {
  phase: 'idle',
  progress: 0,
  loadedPair: null,
  timeline: null,
  errors: [],
  warnings: [],
  playing: false,
  positionSec: 0,
  volume: 1,
  keyShift: false,
  keyShiftSemitones: null,
};

function firstDownbeatSec(grid: BeatGridRow | null): number | null {
  const ms = grid?.first_downbeat_ms ?? grid?.first_beat_ms ?? null;
  return ms != null && Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

export function useFlipLab() {
  const globalPlayer = useAudioPlayer();
  const [state, setState] = useState<FlipLabState>(INITIAL);
  const engineRef = useRef<FlipLabEngine | null>(null);
  const stretcherRef = useRef(createRouletteTimeStretchProcessor());
  const generationRef = useRef(0);
  const pairRef = useRef<FlipLabPairInput | null>(null);
  const rawVocalRef = useRef<AudioBuffer | null>(null);
  const instrumentalRef = useRef<AudioBuffer | null>(null);
  const keyShiftRef = useRef(false);
  const volumeRef = useRef(1);

  const engine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new FlipLabEngine();
      engineRef.current.setVolume(volumeRef.current);
      engineRef.current.onEnded = () => setState((s) => ({ ...s, playing: false, positionSec: 0 }));
    }
    return engineRef.current;
  }, []);

  // Stretch the vocal to the instrumental tempo. With key shift on, the buffer
  // is stretched by tempo/pitch and then resampled by `pitch` during playback,
  // which lands on the instrumental tempo at the shifted pitch.
  const buildVocal = useCallback(async (timeline: FlipLabTimeline, semitones: number | null, keyShift: boolean) => {
    const raw = rawVocalRef.current;
    if (!raw) throw new Error('The vocal stem is not loaded.');
    const pitch = keyShift && semitones != null ? 2 ** (semitones / 12) : 1;
    const stretchRatio = timeline.tempoRatio / pitch;
    const vocal = Math.abs(stretchRatio - 1) < 1e-6
      ? raw
      : await stretcherRef.current.prepare({
        context: engine().context as AudioContext,
        buffer: raw,
        offsetSeconds: 0,
        sourceDurationSeconds: raw.duration,
        tempoRatio: stretchRatio,
      });
    return { vocal, vocalRate: pitch };
  }, [engine]);

  const clear = useCallback(() => {
    generationRef.current += 1;
    stretcherRef.current.cancel();
    const pair = pairRef.current;
    if (pair && (state.phase === 'separating')) {
      void cancelFlipLabSeparation([pair.vocal.id, pair.instrumental.id]);
    }
    pairRef.current = null;
    rawVocalRef.current = null;
    instrumentalRef.current = null;
    engineRef.current?.unload();
    setState((s) => ({ ...INITIAL, volume: s.volume, keyShift: s.keyShift }));
  }, [state.phase]);

  const flip = useCallback(async (pair: FlipLabPairInput): Promise<boolean> => {
    const difference = flipLabBpmDifference(pair.vocal.bpm, pair.instrumental.bpm);
    if (difference == null) {
      setState((s) => ({ ...s, errors: ['Both tracks need a BPM before they can be flipped.'] }));
      return false;
    }
    if (difference > FLIP_LAB_MAX_BPM_DIFFERENCE) {
      setState((s) => ({
        ...s,
        errors: [`These tracks are ${difference.toFixed(1)} BPM apart. Flip Lab can only match tracks within ${FLIP_LAB_MAX_BPM_DIFFERENCE} BPM of each other.`],
      }));
      return false;
    }

    const warnings: string[] = [];
    const vocalDownbeat = firstDownbeatSec(pair.vocalBeatGrid);
    const instrumentalDownbeat = firstDownbeatSec(pair.instrumentalBeatGrid);
    if (vocalDownbeat == null) warnings.push(`"${pair.vocal.title}" has no beat grid, so it's lined up from the very start.`);
    if (instrumentalDownbeat == null) warnings.push(`"${pair.instrumental.title}" has no beat grid, so it's lined up from the very start.`);
    const semitones = flipLabKeyShiftSemitones(
      resolveFlipLabCamelotKey(pair.vocal),
      resolveFlipLabCamelotKey(pair.instrumental),
    );
    if (semitones == null) warnings.push('Key Shift is unavailable because one of the tracks has no key.');

    let timeline: FlipLabTimeline;
    try {
      timeline = computeFlipLabTimeline({
        vocalDurationSec: (trackDurationMs(pair.vocal) ?? 0) / 1000,
        instrumentalDurationSec: (trackDurationMs(pair.instrumental) ?? 0) / 1000,
        vocalFirstDownbeatSec: vocalDownbeat ?? 0,
        instrumentalFirstDownbeatSec: instrumentalDownbeat ?? 0,
        vocalBpm: pair.vocal.bpm!,
        instrumentalBpm: pair.instrumental.bpm!,
      });
    } catch (error) {
      setState((s) => ({ ...s, errors: [error instanceof Error ? error.message : String(error)] }));
      return false;
    }

    const generation = ++generationRef.current;
    stretcherRef.current.cancel();
    engineRef.current?.unload();
    pairRef.current = pair;
    rawVocalRef.current = null;
    instrumentalRef.current = null;
    setState((s) => ({
      ...INITIAL,
      volume: s.volume,
      keyShift: s.keyShift,
      phase: 'separating',
      loadedPair: { vocalId: pair.vocal.id, instrumentalId: pair.instrumental.id },
      timeline,
      warnings,
      keyShiftSemitones: semitones,
    }));

    const result = await separateFlipLabPair(pair.vocal, pair.instrumental, (progress) => {
      if (generation !== generationRef.current) return;
      setState((s) => ({ ...s, progress: Math.max(s.progress, progress) }));
    });
    if (generation !== generationRef.current) return true;
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      setState((s) => ({ ...s, phase: 'error', errors: [failure.message] }));
      return true;
    }

    setState((s) => ({ ...s, phase: 'preparing', progress: 1 }));
    try {
      const context = engine().context;
      const [rawVocal, instrumental] = await Promise.all([
        loadFlipLabStemAudio(result.vocalLocator, context),
        loadFlipLabStemAudio(result.instrumentalLocator, context),
      ]);
      if (generation !== generationRef.current) return true;
      rawVocalRef.current = rawVocal;
      instrumentalRef.current = instrumental;
      // Decoded lengths are exact; metadata durations are only a layout estimate.
      const exactTimeline = computeFlipLabTimeline({
        vocalDurationSec: rawVocal.duration,
        instrumentalDurationSec: instrumental.duration,
        vocalFirstDownbeatSec: vocalDownbeat ?? 0,
        instrumentalFirstDownbeatSec: instrumentalDownbeat ?? 0,
        vocalBpm: pair.vocal.bpm!,
        instrumentalBpm: pair.instrumental.bpm!,
      });
      const { vocal, vocalRate } = await buildVocal(exactTimeline, semitones, keyShiftRef.current);
      if (generation !== generationRef.current) return true;
      engine().load({ timeline: exactTimeline, instrumental, vocal, vocalRate });
      setState((s) => ({ ...s, phase: 'ready', timeline: exactTimeline, positionSec: 0 }));
    } catch (error) {
      if (generation !== generationRef.current) return true;
      if (error instanceof DOMException && error.name === 'AbortError') return true;
      setState((s) => ({
        ...s,
        phase: 'error',
        errors: [error instanceof Error ? error.message : 'The separated stems could not be loaded for playback.'],
      }));
    }
    return true;
  }, [buildVocal, engine]);

  const setKeyShift = useCallback(async (on: boolean) => {
    keyShiftRef.current = on;
    setState((s) => ({ ...s, keyShift: on }));
    const current = engineRef.current;
    const instrumental = instrumentalRef.current;
    if (!current || !instrumental || !rawVocalRef.current || state.phase !== 'ready' || !state.timeline) return;
    const generation = generationRef.current;
    const wasPlaying = current.isPlaying();
    current.pause();
    setState((s) => ({ ...s, phase: 'preparing', playing: false }));
    try {
      const { vocal, vocalRate } = await buildVocal(state.timeline, state.keyShiftSemitones, on);
      if (generation !== generationRef.current) return;
      current.load({ timeline: state.timeline, instrumental, vocal, vocalRate }, true);
      if (wasPlaying) await current.play();
      setState((s) => ({ ...s, phase: 'ready', playing: wasPlaying }));
    } catch (error) {
      if (generation !== generationRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((s) => ({ ...s, phase: 'error', errors: ['The key shift could not be applied.'] }));
    }
  }, [buildVocal, state.keyShiftSemitones, state.phase, state.timeline]);

  const togglePlay = useCallback(async () => {
    const current = engineRef.current;
    if (!current || state.phase !== 'ready') return;
    if (current.isPlaying()) {
      current.pause();
      setState((s) => ({ ...s, playing: false, positionSec: current.getPosition() }));
      return;
    }
    globalPlayer.stop();
    await current.play();
    setState((s) => ({ ...s, playing: true }));
  }, [globalPlayer, state.phase]);

  const pause = useCallback(() => {
    const current = engineRef.current;
    if (!current?.isPlaying()) return;
    current.pause();
    setState((s) => ({ ...s, playing: false, positionSec: current.getPosition() }));
  }, []);

  const seek = useCallback((positionSec: number) => {
    const current = engineRef.current;
    if (!current) return;
    current.seek(positionSec);
    setState((s) => ({ ...s, positionSec: current.getPosition() }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    const next = Math.max(0, Math.min(1, volume));
    volumeRef.current = next;
    engineRef.current?.setVolume(next);
    setState((s) => ({ ...s, volume: next }));
  }, []);

  useEffect(() => {
    if (!state.playing) return;
    let frame = 0;
    const tick = () => {
      const current = engineRef.current;
      if (current) setState((s) => ({ ...s, positionSec: current.getPosition() }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing]);

  useEffect(() => {
    const stretcher = stretcherRef.current;
    return () => {
      generationRef.current += 1;
      stretcher.dispose();
      const current = engineRef.current;
      engineRef.current = null;
      void current?.dispose();
    };
  }, []);

  const busy = state.phase === 'separating' || state.phase === 'preparing';
  return useMemo(() => ({
    state,
    busy,
    flip,
    clear,
    togglePlay,
    pause,
    seek,
    setVolume,
    setKeyShift,
  }), [busy, clear, flip, pause, seek, setKeyShift, setVolume, state, togglePlay]);
}
