import type { RekordboxTrack } from '../../types';
import {
  loadDecodedAudioSources,
  type AudioSourceLoadDependencies,
  type DecodedAudioSourceRequest,
} from '../../lib/audio/audioSourceLoader';
import { DecodedAudioCache } from '../../lib/audio/decodedAudioCache';
import {
  closeAudioContext,
  createBrowserAudioContext,
  scheduleAudioBufferClips,
  stopAndDisconnectAudioNodes,
  type ScheduledAudioClips,
} from '../../lib/audio/webAudioScheduling';
import { fetchTrackBeatGrid, type BeatGridRow } from '../../lib/queries/analysisData';
import { fetchRouletteTrack } from '../../lib/queries/rouletteCandidates';
import { rouletteStemAssetService, type StemAssetService } from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole } from './stemAssets';
import { buildRouletteBarFractions, resolveRouletteAlignment } from './rouletteAlignment';
import type { RouletteSourceRole, RouletteSourceSelection } from './rouletteSession';
import { extractRouletteStemPeaks } from './rouletteWaveform';

export interface RouletteDeckMix {
  gain: number;
  muted: boolean;
  solo: boolean;
}

export type RouletteMixState = Record<RouletteSourceRole, RouletteDeckMix>;

export interface RoulettePlaybackSources {
  vocal: RouletteSourceSelection;
  instrumental: RouletteSourceSelection;
}

export interface RoulettePlaybackResult {
  masterBpm: number;
  durationSeconds: number;
  startAt: number;
  waveforms: Record<RouletteSourceRole, number[]>;
  barFractions: number[];
}

export interface RouletteAudioRuntime {
  play(
    sources: RoulettePlaybackSources,
    mix: RouletteMixState,
    onEnded?: () => void,
  ): Promise<RoulettePlaybackResult>;
  stop(): void;
  setMix(mix: RouletteMixState): void;
  getPositionSeconds(): number;
  getDurationSeconds(): number;
  clearCache(): void;
  dispose(): Promise<void>;
}

type RouletteDecodedSourceLoader = (
  requests: DecodedAudioSourceRequest[],
  dependencies: AudioSourceLoadDependencies,
) => Promise<AudioBuffer[]>;

interface RouletteRuntimeDependencies {
  loadTrack(trackId: string): Promise<RekordboxTrack | null>;
  loadBeatGrid(trackId: string): Promise<BeatGridRow | null>;
  stemAssets: Pick<StemAssetService, 'resolveReady'>;
  getAudioContext(): AudioContext;
  decodedCache: DecodedAudioCache<AudioBuffer>;
  loadDecodedSources: RouletteDecodedSourceLoader;
  scheduleClips: typeof scheduleAudioBufferClips;
  fetchImpl: typeof fetch;
}

function defaultDependencies(): RouletteRuntimeDependencies {
  return {
    loadTrack: fetchRouletteTrack,
    loadBeatGrid: fetchTrackBeatGrid,
    stemAssets: rouletteStemAssetService,
    getAudioContext: createBrowserAudioContext,
    decodedCache: new DecodedAudioCache<AudioBuffer>(6),
    loadDecodedSources: loadDecodedAudioSources,
    scheduleClips: scheduleAudioBufferClips,
    fetchImpl: fetch,
  };
}

function abortError(): DOMException {
  return new DOMException('Roulette audio request cancelled.', 'AbortError');
}

function throwIfCancelled(generation: number, activeGeneration: number, signal?: AbortSignal): void {
  if (generation !== activeGeneration || signal?.aborted) throw abortError();
}

function validSelection(selection: RouletteSourceSelection): selection is RouletteSourceSelection & {
  parentTrackId: string;
  stemRef: string;
} {
  return Boolean(
    selection.parentTrackId
    && selection.stemRef
    && selection.stemStatus === 'ready',
  );
}

function clampGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function effectiveDeckGain(role: RouletteSourceRole, mix: RouletteMixState): number {
  const deck = mix[role];
  const anySolo = mix.vocal.solo || mix.instrumental.solo;
  if (deck.muted || (anySolo && !deck.solo)) return 0;
  return clampGain(deck.gain);
}

function setGain(node: GainNode, value: number, context: AudioContext): void {
  if (typeof node.gain.setValueAtTime === 'function') node.gain.setValueAtTime(value, context.currentTime);
  else node.gain.value = value;
}

function disconnectNode(node: AudioNode | null): void {
  if (!node) return;
  try { node.disconnect(); } catch { /* already disconnected */ }
}

/** Dedicated, memory-only Roulette Web Audio owner. */
export function createRouletteAudioRuntime(
  overrides: Partial<RouletteRuntimeDependencies> = {},
): RouletteAudioRuntime {
  const dependencies = { ...defaultDependencies(), ...overrides };
  let audioContext: AudioContext | null = null;
  let activeGeneration = 0;
  let loadController: AbortController | null = null;
  let scheduledNodes: AudioBufferSourceNode[] = [];
  let deckGainNodes: Partial<Record<RouletteSourceRole, GainNode>> = {};
  let masterGainNode: GainNode | null = null;
  let startAt = 0;
  let durationSeconds = 0;

  const stopActiveGraph = () => {
    stopAndDisconnectAudioNodes(scheduledNodes);
    scheduledNodes = [];
    disconnectNode(deckGainNodes.vocal ?? null);
    disconnectNode(deckGainNodes.instrumental ?? null);
    disconnectNode(masterGainNode);
    deckGainNodes = {};
    masterGainNode = null;
    startAt = 0;
    durationSeconds = 0;
  };

  const stop = () => {
    activeGeneration += 1;
    loadController?.abort();
    loadController = null;
    stopActiveGraph();
  };

  const setMix = (mix: RouletteMixState) => {
    if (!audioContext) return;
    const vocalNode = deckGainNodes.vocal;
    const instrumentalNode = deckGainNodes.instrumental;
    if (vocalNode) setGain(vocalNode, effectiveDeckGain('vocal', mix), audioContext);
    if (instrumentalNode) setGain(instrumentalNode, effectiveDeckGain('instrumental', mix), audioContext);
  };

  const play = async (
    sources: RoulettePlaybackSources,
    mix: RouletteMixState,
    onEnded?: () => void,
  ): Promise<RoulettePlaybackResult> => {
    stop();
    const generation = ++activeGeneration;
    const controller = new AbortController();
    loadController = controller;

    if (!validSelection(sources.vocal) || !validSelection(sources.instrumental)) {
      throw new Error('Roulette playback requires two selected, ready stem sources.');
    }

    const [vocalTrack, instrumentalTrack, vocalGrid, instrumentalGrid, vocalMedia, instrumentalMedia] = await Promise.all([
      dependencies.loadTrack(sources.vocal.parentTrackId),
      dependencies.loadTrack(sources.instrumental.parentTrackId),
      dependencies.loadBeatGrid(sources.vocal.parentTrackId),
      dependencies.loadBeatGrid(sources.instrumental.parentTrackId),
      dependencies.stemAssets.resolveReady(sources.vocal.parentTrackId, stemTypeForRole('vocal'), { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
      dependencies.stemAssets.resolveReady(sources.instrumental.parentTrackId, stemTypeForRole('instrumental'), { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
    ]);
    throwIfCancelled(generation, activeGeneration, controller.signal);

    if (!vocalTrack || !instrumentalTrack) {
      throw new Error('Roulette parent-track metadata is unavailable.');
    }
    if (!vocalMedia || !instrumentalMedia) {
      throw new Error('A selected Roulette stem is missing or no longer ready.');
    }
    if (vocalMedia.asset.id !== sources.vocal.stemRef || instrumentalMedia.asset.id !== sources.instrumental.stemRef) {
      throw new Error('A selected Roulette stem changed after matching. Roulette the source again.');
    }

    const alignment = resolveRouletteAlignment(
      { track: vocalTrack, beatGrid: vocalGrid },
      { track: instrumentalTrack, beatGrid: instrumentalGrid },
    );

    const context = audioContext ?? dependencies.getAudioContext();
    audioContext = context;
    if (context.state === 'closed') throw new Error('Roulette audio engine is closed. Reopen Roulette and retry.');
    if (context.state === 'suspended') await context.resume();
    throwIfCancelled(generation, activeGeneration, controller.signal);

    const sourceByRole = {
      vocal: vocalMedia.source,
      instrumental: instrumentalMedia.source,
    } as const;
    const cacheKeyFor = (role: RouletteSourceRole) => {
      const media = role === 'vocal' ? vocalMedia : instrumentalMedia;
      return `roulette:${media.asset.id}:${media.source.size}:${media.source.mtimeMs}`;
    };

    const loadDependencies: AudioSourceLoadDependencies = {
      cache: dependencies.decodedCache,
      resolveSource: async (segments) => {
        const role = segments[0] as RouletteSourceRole;
        const media = sourceByRole[role];
        if (!media) return { ok: false, error: new Error('Unknown Roulette stem role.') };
        return { ok: true, source: { kind: 'url', url: media.url } };
      },
      getAudioContext: () => context,
      isCancelled: () => generation !== activeGeneration || controller.signal.aborted,
      fetchImpl: (input, init) => dependencies.fetchImpl(input, { ...init, signal: controller.signal }),
      mapResolveError: (error) => error instanceof Error ? error : new Error(String(error)),
    };

    const [vocalBuffer, instrumentalBuffer] = await dependencies.loadDecodedSources(
      [
        { cacheKey: cacheKeyFor('vocal'), pathSegments: ['vocal'] },
        { cacheKey: cacheKeyFor('instrumental'), pathSegments: ['instrumental'] },
      ],
      loadDependencies,
    );
    throwIfCancelled(generation, activeGeneration, controller.signal);

    const vocalAvailable = Math.max(0, vocalBuffer.duration - alignment.vocal.sourceOffsetSeconds);
    const instrumentalAvailable = Math.max(0, instrumentalBuffer.duration - alignment.instrumental.sourceOffsetSeconds);
    const sharedDuration = Math.min(vocalAvailable, instrumentalAvailable);
    if (!Number.isFinite(sharedDuration) || sharedDuration <= 0) {
      throw new Error('The aligned Roulette downbeat falls outside one of the decoded stems.');
    }

    // Build visual data before scheduling any audible nodes. If decoded-buffer
    // inspection fails, Play fails atomically instead of leaving audio running.
    const waveforms = {
      vocal: extractRouletteStemPeaks(
        vocalBuffer,
        alignment.vocal.sourceOffsetSeconds,
        sharedDuration,
      ),
      instrumental: extractRouletteStemPeaks(
        instrumentalBuffer,
        alignment.instrumental.sourceOffsetSeconds,
        sharedDuration,
      ),
    };
    const barFractions = buildRouletteBarFractions(sharedDuration, alignment.barDurationSeconds);

    const masterGain = context.createGain();
    // Two full-scale stems can sum above unity. Reserve fixed headroom without
    // introducing the later-stage limiter/effects surface.
    masterGain.gain.value = 0.72;
    masterGain.connect(context.destination);
    const vocalGain = context.createGain();
    const instrumentalGain = context.createGain();
    vocalGain.connect(masterGain);
    instrumentalGain.connect(masterGain);
    deckGainNodes = { vocal: vocalGain, instrumental: instrumentalGain };
    masterGainNode = masterGain;
    setMix(mix);

    let scheduled: ScheduledAudioClips;
    try {
      scheduled = dependencies.scheduleClips(
        context,
        [
          {
            buffer: vocalBuffer,
            offsetSeconds: alignment.vocal.sourceOffsetSeconds,
            durationSeconds: sharedDuration,
            startOffsetSeconds: 0,
            destination: vocalGain,
          },
          {
            buffer: instrumentalBuffer,
            offsetSeconds: alignment.instrumental.sourceOffsetSeconds,
            durationSeconds: sharedDuration,
            startOffsetSeconds: 0,
            destination: instrumentalGain,
          },
        ],
        { leadInSeconds: 0.05 },
      );
    } catch (error) {
      stopActiveGraph();
      throw error;
    }
    scheduledNodes = scheduled.nodes;
    try {
      throwIfCancelled(generation, activeGeneration, controller.signal);
    } catch (error) {
      stopActiveGraph();
      throw error;
    }

    startAt = scheduled.startAt;
    durationSeconds = sharedDuration;
    loadController = null;

    const finalNode = scheduled.nodes.at(-1);
    if (finalNode) {
      finalNode.onended = () => {
        if (generation !== activeGeneration || !scheduledNodes.includes(finalNode)) return;
        stopActiveGraph();
        onEnded?.();
      };
    }

    return {
      masterBpm: alignment.masterBpm,
      durationSeconds: sharedDuration,
      startAt: scheduled.startAt,
      waveforms,
      barFractions,
    };
  };

  return {
    play,
    stop,
    setMix,
    getPositionSeconds: () => {
      if (!audioContext || startAt <= 0 || durationSeconds <= 0) return 0;
      return Math.max(0, Math.min(durationSeconds, audioContext.currentTime - startAt));
    },
    getDurationSeconds: () => durationSeconds,
    clearCache: () => dependencies.decodedCache.clear(),
    dispose: async () => {
      stop();
      dependencies.decodedCache.clear();
      const context = audioContext;
      audioContext = null;
      await closeAudioContext(context);
    },
  };
}
