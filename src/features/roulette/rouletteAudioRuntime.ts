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
import {
  fetchTrackBeatGrid,
  fetchTrackPhrases,
  fetchTrackVocalAnalysis,
  type BeatGridRow,
  type PhraseRow,
  type VocalAnalysisRow,
} from '../../lib/queries/analysisData';
import { fetchRouletteTrack } from '../../lib/queries/rouletteCandidates';
import { rouletteStemAssetService, type StemAssetService } from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole } from './stemAssets';
import { buildRouletteBarFractions, resolveRouletteAlignment } from './rouletteAlignment';
import { hasUsableRouletteBeatGrid } from './rouletteMatching';
import {
  ROULETTE_ANCHOR_WINDOW_BARS,
  resolveRouletteMusicalAnchor,
  type RouletteMusicalAnchor,
} from './rouletteAnchors';
import type { RouletteSourceRole, RouletteSourceSelection, RouletteSourceWindow } from './rouletteSession';
import { extractRouletteStemPeaks } from './rouletteWaveform';
import { roulettePreparedAssetRef, type ResolvedRouletteAuditionMedia } from './roulettePreview';
import { roulettePreviewPreparationService, type RoulettePreviewPreparationService } from './roulettePreviewPreparationService';
import {
  rouletteOutputDurationSeconds,
  rouletteSourceDurationSeconds,
  type RouletteDeckTempoPlan,
} from './rouletteTempoSync';
import {
  createRouletteTimeStretchProcessor,
  type RouletteTimeStretchProcessor,
} from './rouletteTimeStretch';

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
  anchors: Record<RouletteSourceRole, RouletteMusicalAnchor>;
}

export interface RouletteAudioRuntime {
  prepare(sources: RoulettePlaybackSources, signal?: AbortSignal): Promise<void>;
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
  loadPhrases(trackId: string): Promise<PhraseRow[]>;
  loadVocalAnalysis(trackId: string): Promise<VocalAnalysisRow | null>;
  stemAssets: Pick<StemAssetService, 'resolveReady'>;
  previewAssets: Pick<RoulettePreviewPreparationService, 'getState' | 'resolvePreparedAsset'>;
  getAudioContext(): AudioContext;
  decodedCache: DecodedAudioCache<AudioBuffer>;
  stretchedCache: DecodedAudioCache<AudioBuffer>;
  createTempoProcessor(): RouletteTimeStretchProcessor;
  loadDecodedSources: RouletteDecodedSourceLoader;
  scheduleClips: typeof scheduleAudioBufferClips;
  fetchImpl: typeof fetch;
}

export function rouletteAudioBufferByteSize(buffer: AudioBuffer): number {
  return Math.max(0, buffer.length) * Math.max(0, buffer.numberOfChannels) * Float32Array.BYTES_PER_ELEMENT;
}

const MEBIBYTE = 1024 * 1024;
const ROULETTE_DECODED_CACHE_BUDGET_BYTES = 192 * MEBIBYTE;
const ROULETTE_STRETCHED_CACHE_BUDGET_BYTES = 96 * MEBIBYTE;
const ROULETTE_MASTER_HEADROOM = 0.707;

function defaultDependencies(): RouletteRuntimeDependencies {
  return {
    loadTrack: fetchRouletteTrack,
    loadBeatGrid: fetchTrackBeatGrid,
    loadPhrases: fetchTrackPhrases,
    loadVocalAnalysis: fetchTrackVocalAnalysis,
    stemAssets: rouletteStemAssetService,
    previewAssets: roulettePreviewPreparationService,
    getAudioContext: createBrowserAudioContext,
    decodedCache: new DecodedAudioCache<AudioBuffer>(8, {
      maxBytes: ROULETTE_DECODED_CACHE_BUDGET_BYTES,
      sizeOf: rouletteAudioBufferByteSize,
    }),
    stretchedCache: new DecodedAudioCache<AudioBuffer>(4, {
      maxBytes: ROULETTE_STRETCHED_CACHE_BUDGET_BYTES,
      sizeOf: rouletteAudioBufferByteSize,
    }),
    createTempoProcessor: createRouletteTimeStretchProcessor,
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

interface RouletteRuntimeMedia {
  assetKind: 'hq' | 'preview' | 'legacy-hq';
  assetRef: string;
  source: { kind: 'url'; url: string; size: number; mtimeMs: number };
  /** Seek offset in the resolved media. Preview clips begin at zero. */
  mediaStartMs: number | null;
  window: RouletteSourceWindow | null;
  durationMs: number | null;
}

function anchorFromLockedWindow(
  role: RouletteSourceRole,
  parentTrackId: string,
  beatGrid: BeatGridRow | null,
  window: RouletteSourceWindow,
): RouletteMusicalAnchor {
  const anchorBeat = window.sourceBeatSequence == null
    ? null
    : beatGrid?.beats.find((beat) => beat.seq === window.sourceBeatSequence) ?? null;
  return {
    role,
    parentTrackId,
    sourceTimeMs: window.sourceTimeMs,
    sourceBar: window.sourceBar,
    sourceBeatSequence: window.sourceBeatSequence,
    anchorBeat,
    requestedBars: window.requestedBars,
    windowEndMs: window.windowEndMs,
    usableWindowMs: window.durationMs,
    provenance: window.provenance,
    reason: 'Locked Roulette source window selected during candidate preparation.',
  };
}

/** Dedicated, memory-only Roulette Web Audio owner. */
export function createRouletteAudioRuntime(
  overrides: Partial<RouletteRuntimeDependencies> = {},
): RouletteAudioRuntime {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const tempoProcessor = dependencies.createTempoProcessor();
  let audioContext: AudioContext | null = null;
  let activeGeneration = 0;
  let loadController: AbortController | null = null;
  let scheduledNodes: AudioBufferSourceNode[] = [];
  let deckGainNodes: Partial<Record<RouletteSourceRole, GainNode>> = {};
  let masterGainNode: GainNode | null = null;
  let masterLimiterNode: DynamicsCompressorNode | null = null;
  let startAt = 0;
  let durationSeconds = 0;

  const stopActiveGraph = () => {
    stopAndDisconnectAudioNodes(scheduledNodes);
    scheduledNodes = [];
    disconnectNode(deckGainNodes.vocal ?? null);
    disconnectNode(deckGainNodes.instrumental ?? null);
    disconnectNode(masterGainNode);
    disconnectNode(masterLimiterNode);
    deckGainNodes = {};
    masterGainNode = null;
    masterLimiterNode = null;
    startAt = 0;
    durationSeconds = 0;
  };

  const stop = () => {
    activeGeneration += 1;
    loadController?.abort();
    loadController = null;
    tempoProcessor.cancel();
    stopActiveGraph();
  };

  const setMix = (mix: RouletteMixState) => {
    if (!audioContext) return;
    const vocalNode = deckGainNodes.vocal;
    const instrumentalNode = deckGainNodes.instrumental;
    if (vocalNode) setGain(vocalNode, effectiveDeckGain('vocal', mix), audioContext);
    if (instrumentalNode) setGain(instrumentalNode, effectiveDeckGain('instrumental', mix), audioContext);
  };

  const resolveSelectionMedia = async (
    role: RouletteSourceRole,
    selection: RouletteSourceSelection & { parentTrackId: string; stemRef: string },
  ): Promise<RouletteRuntimeMedia | null> => {
    const preparedState = dependencies.previewAssets.getState(selection.parentTrackId, role);
    if (
      preparedState?.status === 'ready'
      && preparedState.asset
      && roulettePreparedAssetRef(preparedState.asset) === selection.stemRef
    ) {
      const resolved: ResolvedRouletteAuditionMedia | null = await dependencies.previewAssets.resolvePreparedAsset(preparedState.asset);
      if (!resolved) return null;
      return {
        assetKind: resolved.assetKind,
        assetRef: selection.stemRef,
        source: resolved.source,
        mediaStartMs: resolved.mediaStartMs,
        window: selection.window ?? resolved.window,
        durationMs: preparedState.asset.kind === 'hq'
          ? preparedState.asset.asset.duration_ms
          : preparedState.asset.output.durationMs,
      };
    }

    // Legacy/fallback path for ready HQ selections created before Stage 5 or in
    // tests. Preview selections are never substituted with the full parent mix.
    if (selection.stemRef.startsWith('preview:')) return null;
    const ready = await dependencies.stemAssets.resolveReady(
      selection.parentTrackId,
      stemTypeForRole(role),
      { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION },
    );
    if (!ready || ready.asset.id !== selection.stemRef) return null;
    return {
      assetKind: 'legacy-hq',
      assetRef: ready.asset.id,
      source: ready.source,
      mediaStartMs: null,
      window: selection.window ?? null,
      durationMs: ready.asset.duration_ms,
    };
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

    const [
      vocalTrack,
      instrumentalTrack,
      vocalGrid,
      instrumentalGrid,
      vocalPhrases,
      instrumentalPhrases,
      vocalAnalysis,
      vocalMedia,
      instrumentalMedia,
    ] = await Promise.all([
      dependencies.loadTrack(sources.vocal.parentTrackId),
      dependencies.loadTrack(sources.instrumental.parentTrackId),
      dependencies.loadBeatGrid(sources.vocal.parentTrackId),
      dependencies.loadBeatGrid(sources.instrumental.parentTrackId),
      dependencies.loadPhrases(sources.vocal.parentTrackId),
      dependencies.loadPhrases(sources.instrumental.parentTrackId),
      dependencies.loadVocalAnalysis(sources.vocal.parentTrackId),
      resolveSelectionMedia('vocal', sources.vocal),
      resolveSelectionMedia('instrumental', sources.instrumental),
    ]);
    throwIfCancelled(generation, activeGeneration, controller.signal);

    if (!vocalTrack || !instrumentalTrack) {
      throw new Error('Roulette parent-track metadata is unavailable.');
    }
    if (!vocalMedia || !instrumentalMedia) {
      throw new Error('A selected Roulette audition asset is missing or no longer ready.');
    }
    if (!hasUsableRouletteBeatGrid(vocalGrid) || !hasUsableRouletteBeatGrid(instrumentalGrid)) {
      throw new Error('Roulette playback requires a usable Rekordbox beat grid for both parent tracks.');
    }
    if (vocalMedia.assetRef !== sources.vocal.stemRef || instrumentalMedia.assetRef !== sources.instrumental.stemRef) {
      throw new Error('A selected Roulette audition asset changed after matching. Roulette the source again.');
    }

    const vocalAnchor = vocalMedia.window
      ? anchorFromLockedWindow('vocal', vocalTrack.id, vocalGrid, vocalMedia.window)
      : resolveRouletteMusicalAnchor({
        role: 'vocal',
        track: vocalTrack,
        beatGrid: vocalGrid,
        phrases: vocalPhrases,
        vocalAnalysis,
        durationMs: vocalMedia.durationMs,
        requestedBars: ROULETTE_ANCHOR_WINDOW_BARS,
      });
    const instrumentalAnchor = instrumentalMedia.window
      ? anchorFromLockedWindow('instrumental', instrumentalTrack.id, instrumentalGrid, instrumentalMedia.window)
      : resolveRouletteMusicalAnchor({
        role: 'instrumental',
        track: instrumentalTrack,
        beatGrid: instrumentalGrid,
        phrases: instrumentalPhrases,
        durationMs: instrumentalMedia.durationMs,
        requestedBars: ROULETTE_ANCHOR_WINDOW_BARS,
      });
    if (!vocalAnchor || !instrumentalAnchor) {
      throw new Error(`Roulette could not resolve a ${ROULETTE_ANCHOR_WINDOW_BARS}-bar musical window for both parent tracks.`);
    }

    const alignment = resolveRouletteAlignment(
      { track: vocalTrack, beatGrid: vocalGrid, musicalAnchor: vocalAnchor },
      { track: instrumentalTrack, beatGrid: instrumentalGrid, musicalAnchor: instrumentalAnchor },
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
      return `roulette:${media.assetRef}:${media.source.size}:${media.source.mtimeMs}`;
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

    const vocalSourceOffsetSeconds = vocalMedia.mediaStartMs == null
      ? alignment.vocal.sourceOffsetSeconds
      : vocalMedia.mediaStartMs / 1000;
    const instrumentalSourceOffsetSeconds = instrumentalMedia.mediaStartMs == null
      ? alignment.instrumental.sourceOffsetSeconds
      : instrumentalMedia.mediaStartMs / 1000;
    const vocalSourceAvailable = Math.max(0, vocalBuffer.duration - vocalSourceOffsetSeconds);
    const instrumentalSourceAvailable = Math.max(0, instrumentalBuffer.duration - instrumentalSourceOffsetSeconds);
    const vocalAvailable = rouletteOutputDurationSeconds(vocalSourceAvailable, alignment.tempo.vocal);
    const instrumentalAvailable = rouletteOutputDurationSeconds(instrumentalSourceAvailable, alignment.tempo.instrumental);
    const vocalAnchorWindow = rouletteOutputDurationSeconds(vocalAnchor.usableWindowMs / 1000, alignment.tempo.vocal);
    const instrumentalAnchorWindow = rouletteOutputDurationSeconds(
      instrumentalAnchor.usableWindowMs / 1000,
      alignment.tempo.instrumental,
    );
    const targetDuration = Math.min(
      vocalAvailable,
      instrumentalAvailable,
      vocalAnchorWindow,
      instrumentalAnchorWindow,
    );
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      throw new Error('The resolved Roulette musical window falls outside one of the decoded stems.');
    }

    type PreparedDeck = { buffer: AudioBuffer; offsetSeconds: number };
    const prepareDeck = async (
      role: RouletteSourceRole,
      buffer: AudioBuffer,
      offsetSeconds: number,
      plan: RouletteDeckTempoPlan,
    ): Promise<PreparedDeck> => {
      if (!plan.requiresPitchLockedProcessing) return { buffer, offsetSeconds };

      const media = role === 'vocal' ? vocalMedia : instrumentalMedia;
      const sourceDurationSeconds = Math.min(
        Math.max(0, buffer.duration - offsetSeconds),
        rouletteSourceDurationSeconds(targetDuration, plan),
      );
      const cacheKey = [
        'roulette-tempo-v1',
        media.assetRef,
        Math.round(offsetSeconds * buffer.sampleRate),
        plan.sourceBpm.toFixed(6),
        plan.targetBpm.toFixed(6),
        Math.round(sourceDurationSeconds * buffer.sampleRate),
      ].join(':');
      const processed = await dependencies.stretchedCache.getOrCreate(cacheKey, () => tempoProcessor.prepare({
        context,
        buffer,
        offsetSeconds,
        sourceDurationSeconds,
        tempoRatio: plan.tempoRatio,
        signal: controller.signal,
      }));
      throwIfCancelled(generation, activeGeneration, controller.signal);
      return { buffer: processed, offsetSeconds: 0 };
    };

    let preparedVocal: PreparedDeck;
    let preparedInstrumental: PreparedDeck;
    try {
      [preparedVocal, preparedInstrumental] = await Promise.all([
        prepareDeck('vocal', vocalBuffer, vocalSourceOffsetSeconds, alignment.tempo.vocal),
        prepareDeck('instrumental', instrumentalBuffer, instrumentalSourceOffsetSeconds, alignment.tempo.instrumental),
      ]);
    } catch (error) {
      tempoProcessor.cancel();
      throw error;
    }
    throwIfCancelled(generation, activeGeneration, controller.signal);

    const playbackDuration = Math.min(
      targetDuration,
      Math.max(0, preparedVocal.buffer.duration - preparedVocal.offsetSeconds),
      Math.max(0, preparedInstrumental.buffer.duration - preparedInstrumental.offsetSeconds),
    );
    if (!Number.isFinite(playbackDuration) || playbackDuration <= 0) {
      throw new Error('Roulette tempo preparation produced an unusable musical window.');
    }

    // Build visual data from the same prepared buffers that will be scheduled.
    // A DSP failure therefore remains atomic and never leaves partial audio live.
    const waveforms = {
      vocal: extractRouletteStemPeaks(
        preparedVocal.buffer,
        preparedVocal.offsetSeconds,
        playbackDuration,
      ),
      instrumental: extractRouletteStemPeaks(
        preparedInstrumental.buffer,
        preparedInstrumental.offsetSeconds,
        playbackDuration,
      ),
    };
    const barFractions = buildRouletteBarFractions(playbackDuration, alignment.barDurationSeconds);

    const masterGain = context.createGain();
    masterGain.gain.value = ROULETTE_MASTER_HEADROOM;
    const createLimiter = context.createDynamicsCompressor?.bind(context);
    const limiter = createLimiter ? createLimiter() : null;
    if (limiter) {
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      masterGain.connect(limiter);
      limiter.connect(context.destination);
      masterLimiterNode = limiter;
    } else {
      masterGain.connect(context.destination);
    }
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
            buffer: preparedVocal.buffer,
            offsetSeconds: preparedVocal.offsetSeconds,
            durationSeconds: playbackDuration,
            startOffsetSeconds: 0,
            destination: vocalGain,
          },
          {
            buffer: preparedInstrumental.buffer,
            offsetSeconds: preparedInstrumental.offsetSeconds,
            durationSeconds: playbackDuration,
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
    durationSeconds = playbackDuration;
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
      durationSeconds: playbackDuration,
      startAt: scheduled.startAt,
      waveforms,
      barFractions,
      anchors: { vocal: vocalAnchor, instrumental: instrumentalAnchor },
    };
  };

  const prepare = async (sources: RoulettePlaybackSources, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw abortError();
    const abort = () => stop();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await play(sources, {
        vocal: { gain: 0, muted: true, solo: false },
        instrumental: { gain: 0, muted: true, solo: false },
      });
      if (signal?.aborted) throw abortError();
    } finally {
      // play() schedules with a short lead-in. Always stop before returning so
      // preflight validates decode/anchors/DSP without making the candidate audible.
      stop();
      signal?.removeEventListener('abort', abort);
    }
  };

  return {
    prepare,
    play,
    stop,
    setMix,
    getPositionSeconds: () => {
      if (!audioContext || startAt <= 0 || durationSeconds <= 0) return 0;
      return Math.max(0, Math.min(durationSeconds, audioContext.currentTime - startAt));
    },
    getDurationSeconds: () => durationSeconds,
    clearCache: () => {
      dependencies.decodedCache.clear();
      dependencies.stretchedCache.clear();
    },
    dispose: async () => {
      stop();
      dependencies.decodedCache.clear();
      dependencies.stretchedCache.clear();
      tempoProcessor.dispose();
      const context = audioContext;
      audioContext = null;
      await closeAudioContext(context);
    },
  };
}
