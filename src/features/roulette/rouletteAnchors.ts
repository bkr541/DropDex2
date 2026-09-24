import type { RekordboxTrack } from '../../types';
import {
  beatAtOrBefore,
  beatByBarOffset,
  downbeatsOnly,
  exactBeatForBoundary,
  isUsableBeatGrid,
  nearestBeat,
  type BeatEntry,
} from '../../lib/music/beatGridHelpers';
import {
  AUTO_CUE_STRATEGY_SETTINGS,
  mapRawPssiCueSemantic,
} from '../../lib/music/autoCueStrategy';
import type {
  BeatGridRow,
  PhraseRow,
  VocalAnalysisRow,
  VocalRegionRow,
} from '../../lib/queries/analysisData';
import type { RouletteSourceRole } from './rouletteSession';
import { summarizeStemWindow } from './rouletteStemMetrics';
import { qualifyingRouletteVocalRegions } from './rouletteVocalQualification';

export const ROULETTE_ANCHOR_WINDOW_BARS = 16;

export type RouletteAnchorProvenance =
  | 'pvdi-phrase'
  | 'pvdi-downbeat'
  | 'phrase'
  | 'downbeat'
  | 'bpm-fallback';

export interface RouletteMusicalAnchor {
  role: RouletteSourceRole;
  parentTrackId: string;
  sourceTimeMs: number;
  sourceBar: number | null;
  sourceBeatSequence: number | null;
  anchorBeat: BeatEntry | null;
  requestedBars: number;
  windowEndMs: number;
  usableWindowMs: number;
  provenance: RouletteAnchorProvenance;
  reason: string;
}

export interface ResolveRouletteMusicalAnchorInput {
  role: RouletteSourceRole;
  track: Pick<RekordboxTrack, 'id' | 'bpm'>;
  beatGrid: BeatGridRow | null;
  phrases: PhraseRow[];
  vocalAnalysis?: VocalAnalysisRow | null;
  durationMs?: number | null;
  requestedBars?: number;
  stemMetrics?: unknown;
}

interface CandidateWindow {
  beat: BeatEntry | null;
  startMs: number;
  endMs: number;
}

interface VocalCandidate extends CandidateWindow {
  provenance: 'pvdi-phrase' | 'pvdi-downbeat';
  overlapMs: number;
  peakConfidence: number;
  onsetDistanceMs: number;
  metricScore: number | null;
}

function validBpm(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validDuration(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function requestedBarCount(value: number | undefined): number {
  return value != null && Number.isInteger(value) && value > 0
    ? value
    : ROULETTE_ANCHOR_WINDOW_BARS;
}

function bpmWindowMs(bpm: number, bars: number): number {
  return (60_000 / bpm) * 4 * bars;
}

function normalizedDownbeat(beats: BeatEntry[], beat: BeatEntry | null): BeatEntry | null {
  if (!beat || !isUsableBeatGrid(beats)) return null;
  if (beat.isDownbeat && beat.beatInBar === 1) return beat;
  return beatAtOrBefore(downbeatsOnly(beats), beat.ms);
}

function phraseDownbeat(beats: BeatEntry[], phrase: PhraseRow): BeatEntry | null {
  const exact = exactBeatForBoundary(beats, {
    beatSequence: phrase.start_beat,
    ms: phrase.start_ms,
  });
  return normalizedDownbeat(beats, exact);
}

function exactCandidateWindow(
  beats: BeatEntry[],
  beat: BeatEntry,
  bars: number,
  durationMs: number | null | undefined,
): CandidateWindow | null {
  const endBeat = beatByBarOffset(beats, beat, bars);
  if (!endBeat) return null;
  if (validDuration(durationMs) && endBeat.ms > durationMs + 1) return null;
  return { beat, startMs: beat.ms, endMs: endBeat.ms };
}

function fallbackCandidateWindow(
  bpm: number | null | undefined,
  bars: number,
  durationMs: number | null | undefined,
): CandidateWindow | null {
  if (!validBpm(bpm)) return null;
  const endMs = bpmWindowMs(bpm, bars);
  if (validDuration(durationMs) && endMs > durationMs + 1) return null;
  return { beat: null, startMs: 0, endMs };
}

function usableWindowForBeat(
  beats: BeatEntry[],
  beat: BeatEntry,
  bars: number,
  durationMs: number | null | undefined,
): CandidateWindow | null {
  if (!isUsableBeatGrid(beats)) return null;
  return exactCandidateWindow(beats, beat, bars, durationMs);
}

function metricScoreForWindow(
  input: ResolveRouletteMusicalAnchorInput,
  window: CandidateWindow,
): number | null {
  return summarizeStemWindow(
    input.stemMetrics,
    window.startMs,
    window.endMs,
    input.role,
  )?.score ?? null;
}

function vocalOverlapMs(regions: VocalRegionRow[], startMs: number, endMs: number): number {
  return regions.reduce((sum, region) => {
    const overlapStart = Math.max(startMs, region.start_ms);
    const overlapEnd = Math.min(endMs, region.end_ms);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}

function peakConfidenceInWindow(regions: VocalRegionRow[], startMs: number, endMs: number): number {
  return regions.reduce((peak, region) => (
    region.start_ms < endMs && region.end_ms > startMs
      ? Math.max(peak, region.peak_confidence)
      : peak
  ), 0);
}

function phraseIsOutro(phrase: PhraseRow): boolean {
  if (mapRawPssiCueSemantic(phrase.source_mood, phrase.source_kind) === 'Outro') return true;
  return phrase.normalized_label?.trim().toLowerCase().includes('outro') ?? false;
}

function phraseWithinTolerance(
  phraseBeat: BeatEntry,
  onsetBeat: BeatEntry,
): boolean {
  if (phraseBeat.ms > onsetBeat.ms) return false;
  if (phraseBeat.bar > 0 && onsetBeat.bar > 0) {
    return onsetBeat.bar - phraseBeat.bar <= AUTO_CUE_STRATEGY_SETTINGS.pvdiPhraseToleranceBars;
  }
  return onsetBeat.seq - phraseBeat.seq <= AUTO_CUE_STRATEGY_SETTINGS.pvdiPhraseToleranceBars * 4;
}

function toAnchor(
  input: ResolveRouletteMusicalAnchorInput,
  window: CandidateWindow,
  provenance: RouletteAnchorProvenance,
  reason: string,
  bars: number,
): RouletteMusicalAnchor {
  return {
    role: input.role,
    parentTrackId: input.track.id,
    sourceTimeMs: window.startMs,
    sourceBar: window.beat && window.beat.bar > 0 ? window.beat.bar : null,
    sourceBeatSequence: window.beat?.seq ?? null,
    anchorBeat: window.beat,
    requestedBars: bars,
    windowEndMs: window.endMs,
    usableWindowMs: window.endMs - window.startMs,
    provenance,
    reason,
  };
}

function resolvePvdiVocalAnchor(
  input: ResolveRouletteMusicalAnchorInput,
  beats: BeatEntry[],
  bars: number,
  regions: VocalRegionRow[],
): RouletteMusicalAnchor | null {
  if (regions.length === 0 || !isUsableBeatGrid(beats)) return null;

  const phraseBeats = input.phrases
    .map((phrase) => ({ phrase, beat: phraseDownbeat(beats, phrase) }))
    .filter((entry): entry is { phrase: PhraseRow; beat: BeatEntry } => entry.beat != null);
  const candidates = new Map<string, VocalCandidate>();

  for (const region of regions) {
    const onsetBeat = nearestBeat(beats, region.start_ms);
    if (!onsetBeat) continue;

    for (const entry of phraseBeats) {
      if (!phraseWithinTolerance(entry.beat, onsetBeat)) continue;
      const window = usableWindowForBeat(beats, entry.beat, bars, input.durationMs);
      if (!window) continue;
      const candidate: VocalCandidate = {
        ...window,
        provenance: 'pvdi-phrase',
        overlapMs: vocalOverlapMs(regions, window.startMs, window.endMs),
        peakConfidence: peakConfidenceInWindow(regions, window.startMs, window.endMs),
        onsetDistanceMs: Math.abs(region.start_ms - window.startMs),
        metricScore: metricScoreForWindow(input, window),
      };
      const key = `beat:${entry.beat.seq}`;
      const previous = candidates.get(key);
      if (!previous || compareVocalCandidates(candidate, previous) < 0) candidates.set(key, candidate);
    }

    const downbeat = beatAtOrBefore(downbeatsOnly(beats), region.start_ms);
    if (downbeat) {
      const window = usableWindowForBeat(beats, downbeat, bars, input.durationMs);
      if (window) {
        const candidate: VocalCandidate = {
          ...window,
          provenance: 'pvdi-downbeat',
          overlapMs: vocalOverlapMs(regions, window.startMs, window.endMs),
          peakConfidence: peakConfidenceInWindow(regions, window.startMs, window.endMs),
          onsetDistanceMs: Math.abs(region.start_ms - window.startMs),
          metricScore: metricScoreForWindow(input, window),
        };
        const key = `beat:${downbeat.seq}`;
        const previous = candidates.get(key);
        if (!previous || compareVocalCandidates(candidate, previous) < 0) candidates.set(key, candidate);
      }
    }
  }

  const best = [...candidates.values()].sort(compareVocalCandidates)[0] ?? null;
  if (!best || best.overlapMs <= 0) return null;
  const reason = best.provenance === 'pvdi-phrase'
    ? 'Meaningful PVDI vocal activity aligned to a nearby Rekordbox phrase downbeat.'
    : 'Meaningful PVDI vocal activity aligned to the exact Rekordbox downbeat at or before the onset.';
  return toAnchor(input, best, best.provenance, reason, bars);
}

function compareVocalCandidates(left: VocalCandidate, right: VocalCandidate): number {
  return right.overlapMs - left.overlapMs
    || right.peakConfidence - left.peakConfidence
    || (left.provenance === 'pvdi-phrase' ? -1 : 1) - (right.provenance === 'pvdi-phrase' ? -1 : 1)
    || (right.metricScore ?? -1) - (left.metricScore ?? -1)
    || left.onsetDistanceMs - right.onsetDistanceMs
    || left.startMs - right.startMs;
}

function resolvePhraseAnchor(
  input: ResolveRouletteMusicalAnchorInput,
  beats: BeatEntry[],
  bars: number,
): RouletteMusicalAnchor | null {
  if (!isUsableBeatGrid(beats)) return null;

  const candidates = input.phrases
    .filter((phrase) => !phraseIsOutro(phrase))
    .map((phrase) => ({ phrase, beat: phraseDownbeat(beats, phrase) }))
    .filter((entry): entry is { phrase: PhraseRow; beat: BeatEntry } => entry.beat != null)
    .flatMap((entry) => {
      const window = usableWindowForBeat(beats, entry.beat, bars, input.durationMs);
      return window ? [{ ...entry, window, metricScore: metricScoreForWindow(input, window) }] : [];
    })
    .sort((left, right) => (right.metricScore ?? -1) - (left.metricScore ?? -1)
      || left.beat.ms - right.beat.ms
      || left.phrase.phrase_index - right.phrase.phrase_index);

  const candidate = candidates[0];
  if (!candidate) return null;
  return toAnchor(
    input,
    candidate.window,
    'phrase',
    `Rekordbox phrase ${candidate.phrase.phrase_index + 1} aligned to its source downbeat.`,
    bars,
  );
}

function resolveDownbeatAnchor(
  input: ResolveRouletteMusicalAnchorInput,
  beats: BeatEntry[],
  bars: number,
): RouletteMusicalAnchor | null {
  if (!isUsableBeatGrid(beats)) return null;
  const downbeats = downbeatsOnly(beats).filter((beat) => beat.beatInBar === 1);
  const ordered = [
    ...downbeats.filter((beat) => beat.bar > 0),
    ...downbeats.filter((beat) => beat.bar <= 0),
  ].flatMap((beat) => {
    const window = usableWindowForBeat(beats, beat, bars, input.durationMs);
    return window ? [{ beat, window, metricScore: metricScoreForWindow(input, window) }] : [];
  }).sort((left, right) => (right.metricScore ?? -1) - (left.metricScore ?? -1)
    || left.beat.ms - right.beat.ms);
  const selected = ordered[0];
  if (!selected) return null;
  return toAnchor(input, selected.window, 'downbeat', 'Exact Rekordbox downbeat with the requested usable bar span.', bars);
}

/**
 * Resolve a deterministic source window for one Roulette deck using the parent
 * track timeline. Stems remain timeline-preserving derivatives and are never
 * independently analyzed for musical timing.
 */
export function resolveRouletteMusicalAnchor(
  input: ResolveRouletteMusicalAnchorInput,
): RouletteMusicalAnchor | null {
  const bars = requestedBarCount(input.requestedBars);
  const beats = input.beatGrid?.beats ?? [];

  if (input.role === 'vocal') {
    return resolvePvdiVocalAnchor(input, beats, bars, qualifyingRouletteVocalRegions(input.vocalAnalysis));
  }

  const phrase = resolvePhraseAnchor(input, beats, bars);
  if (phrase) return phrase;

  const downbeat = resolveDownbeatAnchor(input, beats, bars);
  if (downbeat) return downbeat;

  if (!isUsableBeatGrid(beats)) {
    const fallback = fallbackCandidateWindow(input.track.bpm, bars, input.durationMs);
    if (fallback) {
      return toAnchor(
        input,
        fallback,
        'bpm-fallback',
        'No usable parent beat grid was available; used the existing deterministic BPM-window fallback from source time zero.',
        bars,
      );
    }
  }

  return null;
}
