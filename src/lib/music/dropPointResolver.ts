import type { BeatEntry } from './beatGridHelpers';
import type { CueRow } from './cueHelpers';
import type { PhraseRow } from './phraseHelpers';
import { downbeatsOnly, nearestBeat } from './beatGridHelpers';

export type DropPointConfidence = 'high' | 'medium' | 'low';
export type DropPointSource = 'cue' | 'phrase' | 'fallback';

export interface DropPoint {
  id: string;
  dropMs: number;
  dropBeat: number | null;
  buildStartMs: number;
  confidence: DropPointConfidence;
  source: DropPointSource;
  label: string;
}

export interface ResolveDropPointsInput {
  cues: CueRow[];
  phrases: PhraseRow[];
  beats: BeatEntry[];
  durationMs: number | null;
}

const DROP_RE = /\bdrop\b/i;
const MAX_USER_CUE_SNAP_MS = 750;
const MAX_INFERRED_SNAP_MS = 2500;

function labelOf(phrase: PhraseRow): string {
  return (phrase.normalized_label ?? phrase.source_mood ?? '').trim().toLowerCase();
}

function isUp(label: string): boolean {
  return label === 'up' || label.includes('build') || label.includes('buildup');
}

function isDown(label: string): boolean {
  return label === 'down' || label.includes('drop');
}

function isChorus(label: string): boolean {
  return label === 'chorus';
}

function isPreChorus(label: string): boolean {
  return label === 'verse' || label === 'bridge' || isUp(label);
}

function snapToDownbeat(ms: number, beats: BeatEntry[], maxDistanceMs: number): { ms: number; beat: number | null } {
  const downbeats = downbeatsOnly(beats);
  const nearest = nearestBeat(downbeats.length ? downbeats : beats, ms);
  if (!nearest) return { ms, beat: null };
  if (Math.abs(nearest.ms - ms) > maxDistanceMs) return { ms, beat: nearest.seq ?? null };
  return { ms: nearest.ms, beat: nearest.seq ?? null };
}

function buildStartFor(dropMs: number, phrases: PhraseRow[], beats: BeatEntry[]): number {
  const previousPhrase = phrases
    .filter((phrase) => phrase.start_ms != null && phrase.start_ms < dropMs)
    .sort((a, b) => (b.start_ms ?? 0) - (a.start_ms ?? 0))
    .find((phrase) => isUp(labelOf(phrase)));
  if (previousPhrase?.start_ms != null) return previousPhrase.start_ms;

  const downbeats = downbeatsOnly(beats);
  const dropDownbeatIndex = downbeats.findIndex((beat) => beat.ms >= dropMs);
  if (dropDownbeatIndex >= 0) {
    return downbeats[Math.max(0, dropDownbeatIndex - 8)]?.ms ?? Math.max(0, dropMs - 30_000);
  }
  return Math.max(0, dropMs - 30_000);
}

function createPoint(
  id: string,
  dropMs: number | null,
  confidence: DropPointConfidence,
  source: DropPointSource,
  label: string,
  input: ResolveDropPointsInput,
  snapDistanceMs: number,
): DropPoint | null {
  if (dropMs == null || !Number.isFinite(dropMs) || dropMs < 0) return null;
  const snapped = snapToDownbeat(dropMs, input.beats, snapDistanceMs);
  return {
    id,
    dropMs: snapped.ms,
    dropBeat: snapped.beat,
    buildStartMs: buildStartFor(snapped.ms, input.phrases, input.beats),
    confidence,
    source,
    label,
  };
}

function dedupe(points: DropPoint[]): DropPoint[] {
  const result: DropPoint[] = [];
  for (const point of points) {
    if (!result.some((existing) => Math.abs(existing.dropMs - point.dropMs) < 250)) {
      result.push(point);
    }
  }
  return result;
}

export function resolveDropPoints(input: ResolveDropPointsInput): DropPoint[] {
  const points: DropPoint[] = [];

  for (const cue of input.cues) {
    const cueText = [cue.comment, cue.color_name, cue.hot_cue_slot != null ? `hot ${cue.hot_cue_slot}` : null]
      .filter(Boolean)
      .join(' ');
    if (DROP_RE.test(cueText)) {
      const point = createPoint(
        `cue-${cue.id}`,
        cue.start_ms,
        'high',
        'cue',
        cue.comment?.trim() || 'Drop cue',
        input,
        MAX_USER_CUE_SNAP_MS,
      );
      if (point) points.push(point);
    }
  }

  const phrases = input.phrases.slice().sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));
  for (let i = 0; i < phrases.length - 1; i++) {
    const current = phrases[i];
    const next = phrases[i + 1];
    const currentLabel = labelOf(current);
    const nextLabel = labelOf(next);
    if (isUp(currentLabel) && isDown(nextLabel)) {
      const point = createPoint(`phrase-${current.id}-${next.id}`, next.start_ms, 'high', 'phrase', 'Up into down phrase', input, MAX_INFERRED_SNAP_MS);
      if (point) points.push(point);
    }
  }

  for (let i = 0; i < phrases.length - 1; i++) {
    const current = phrases[i];
    const next = phrases[i + 1];
    if (isUp(labelOf(current)) && isChorus(labelOf(next))) {
      const point = createPoint(`phrase-${current.id}-${next.id}`, next.start_ms, 'medium', 'phrase', 'Build into chorus', input, MAX_INFERRED_SNAP_MS);
      if (point) points.push(point);
    }
  }

  for (let i = 1; i < phrases.length; i++) {
    const previous = phrases[i - 1];
    const current = phrases[i];
    if (isPreChorus(labelOf(previous)) && isChorus(labelOf(current))) {
      const point = createPoint(`phrase-${previous.id}-${current.id}`, current.start_ms, 'medium', 'phrase', 'Chorus entrance', input, MAX_INFERRED_SNAP_MS);
      if (point) points.push(point);
    }
  }

  for (const cue of input.cues) {
    if (cue.start_ms == null) continue;
    const nearest = nearestBeat(downbeatsOnly(input.beats), cue.start_ms);
    if (nearest && Math.abs(nearest.ms - cue.start_ms) <= MAX_USER_CUE_SNAP_MS) {
      const point = createPoint(`cue-downbeat-${cue.id}`, cue.start_ms, 'medium', 'cue', 'Cue near downbeat', input, MAX_USER_CUE_SNAP_MS);
      if (point) points.push(point);
    }
  }

  if (points.length === 0) {
    const firstChorus = phrases.find((phrase) => isChorus(labelOf(phrase)) && phrase.start_ms != null);
    const fallbackMs = firstChorus?.start_ms ?? downbeatsOnly(input.beats)[16]?.ms ?? null;
    const point = createPoint('fallback-structure', fallbackMs, 'low', 'fallback', 'Structure fallback', input, MAX_INFERRED_SNAP_MS);
    if (point && (input.durationMs == null || point.dropMs < input.durationMs)) points.push(point);
  }

  const confidenceRank: Record<DropPointConfidence, number> = { high: 3, medium: 2, low: 1 };
  const sourceRank: Record<DropPointSource, number> = { cue: 3, phrase: 2, fallback: 1 };
  return dedupe(points).sort((a, b) => {
    const byConfidence = confidenceRank[b.confidence] - confidenceRank[a.confidence];
    if (byConfidence !== 0) return byConfidence;
    const bySource = sourceRank[b.source] - sourceRank[a.source];
    if (bySource !== 0) return bySource;
    return a.dropMs - b.dropMs;
  });
}
