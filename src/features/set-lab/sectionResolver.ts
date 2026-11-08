import { downbeatsOnly, isUsableBeatGrid, type BeatEntry } from '../../lib/music/beatGridHelpers';
import type { CueRow, PhraseRow } from '../../lib/queries/analysisData';
import { resolveSetLabPhraseSemantic, setLabPhraseType, type SetLabPhraseSemantic } from './phraseSemantics';
import { DEFAULT_SET_LAB_BAR_COUNT, type SetLabBarCount, type SetLabSection } from './session';

export interface SetLabSectionInput {
  durationMs: number | null;
  beats: BeatEntry[] | null;
  sourceTag?: string | null;
  phrases?: readonly PhraseRow[];
  cues?: readonly CueRow[];
  /** An audition source can end earlier than the imported track. */
  mediaDurationMs?: number;
}

interface PhraseInterval {
  id: string;
  startMs: number;
  endMs: number;
  semantic: SetLabPhraseSemantic;
  occurrence: number | null;
}

interface CueEvidence {
  id: string;
  family: CueRow['cue_family'];
  pointType: CueRow['point_type'];
  hotCueSlot: number | null;
  cueMs: number;
  offsetMs: number;
}

export interface ResolvedSetLabSection {
  section: SetLabSection;
  barCount: SetLabBarCount;
  startDownbeat: BeatEntry;
  endDownbeat: BeatEntry;
  relativePosition: number;
  phraseId: string | null;
  cueEvidence: CueEvidence | null;
  quality: 'cue-aligned' | 'phrase-aligned' | 'grid-only' | 'mixed' | 'pssi-conflict';
  explanation: string;
}

type SectionFailure = {
  ok: false;
  reason: 'invalid-bar-count' | 'invalid-duration' | 'missing-grid' | 'invalid-grid'
    | 'estimated-grid' | 'no-window';
  explanation: string;
};
type SectionResult = { ok: true; window: ResolvedSetLabSection } | SectionFailure;
type SectionList = { ok: true; windows: ResolvedSetLabSection[] } | SectionFailure;

export function isExactSetLabGrid(beats: BeatEntry[]): boolean {
  for (const beat of beats) if (beat == null) return false;
  if (!isUsableBeatGrid(beats)) return false;
  return beats.every((beat, index) => {
    if (!Number.isSafeInteger(beat.seq) || beat.seq < 1
      || !Number.isInteger(beat.beatInBar) || beat.beatInBar < 1 || beat.beatInBar > 4
      || !Number.isSafeInteger(beat.bar) || beat.bar < 0
      || beat.isDownbeat !== (beat.beatInBar === 1) || (beat.isDownbeat && beat.bar < 1)) return false;
    const previous = beats[index - 1];
    if (!previous) return true;
    return beat.seq === previous.seq + 1
      && beat.bar === previous.bar + Number(beat.isDownbeat)
      && (beat.isDownbeat || beat.beatInBar === previous.beatInBar + 1);
  });
}

export function setLabPhraseIntervals(phrases: readonly PhraseRow[], beats: BeatEntry[], durationMs: number): PhraseInterval[] {
  const bySeq = new Map(beats.map(({ seq, ms }) => [seq, ms]));
  const boundary = (seq: number | null, ms: number | null): number | null =>
    (seq != null ? bySeq.get(seq) : undefined) ?? (ms != null && Number.isFinite(ms) && ms >= 0 ? ms : null);
  const lastBeat = beats.at(-1);
  const starts = phrases.flatMap((row) => {
    const startMs = boundary(row.start_beat, row.start_ms);
    return startMs != null && startMs < durationMs ? [{ row, startMs }] : [];
  }).sort((a, b) => a.startMs - b.startMs || a.row.phrase_index - b.row.phrase_index);
  const occurrences = new Map<string, number>();

  return starts.flatMap(({ row, startMs }, index) => {
    const explicitEnd = boundary(row.end_beat, row.end_ms);
    const nextStart = starts[index + 1]?.startMs;
    // A terminal PSSI sequence can lie after the last stored beat. That beat
    // bounds all usable windows even when the terminal timestamp is absent.
    const afterGrid = lastBeat && Number.isSafeInteger(row.end_beat) && row.end_beat! > lastBeat.seq;
    const knownEnd = explicitEnd ?? nextStart ?? (afterGrid ? lastBeat?.ms : null);
    const endMs = Math.min(knownEnd ?? durationMs, durationMs);
    if (endMs <= startMs) return [];
    const semantic: SetLabPhraseSemantic = knownEnd == null
      ? { type: null, evidence: 'unmapped' }
      : resolveSetLabPhraseSemantic(row);
    const occurrence = semantic.type ? (occurrences.get(semantic.type) ?? 0) + 1 : null;
    if (semantic.type && occurrence != null) occurrences.set(semantic.type, occurrence);
    return [{ id: row.id, startMs, endMs, semantic, occurrence }];
  });
}

export function sameSetLabWindow(left: SetLabSection, right: SetLabSection): boolean {
  return left.startMs === right.startMs && left.endMs === right.endMs
    && left.startBeat === right.startBeat && left.endBeatExclusive === right.endBeatExclusive;
}

const CUE_ALIGNMENT_TOLERANCE_MS = 50;

function evidenceForCue(cues: readonly CueRow[], startMs: number): CueEvidence | null {
  let best: CueEvidence | null = null;
  for (const cue of cues) {
    if (cue.source_conflict || !(cue.source_db_present || cue.source_anlz_present)
      || (cue.cue_family !== 'hot' && cue.cue_family !== 'memory')
      || cue.start_ms == null || !Number.isFinite(cue.start_ms) || cue.start_ms < 0) continue;
    const offsetMs = cue.start_ms - startMs;
    if (Math.abs(offsetMs) > CUE_ALIGNMENT_TOLERANCE_MS
      || (best && Math.abs(best.offsetMs) <= Math.abs(offsetMs))) continue;
    best = {
      id: cue.id, family: cue.cue_family, pointType: cue.point_type, hotCueSlot: cue.hot_cue_slot,
      cueMs: cue.start_ms, offsetMs,
    };
  }
  return best;
}

/** Enumerate fixed-length windows for one track. Both endpoints are stored downbeats. */
export function listSetLabSections(input: SetLabSectionInput, barCount: SetLabBarCount = DEFAULT_SET_LAB_BAR_COUNT): SectionList {
  if (barCount !== 4 && barCount !== 8 && barCount !== 16) {
    return { ok: false, reason: 'invalid-bar-count', explanation: 'Set Lab sections must be 4, 8, or 16 bars.' };
  }
  const { durationMs, beats, mediaDurationMs = Infinity } = input;
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0 || !(mediaDurationMs > 0)) {
    return { ok: false, reason: 'invalid-duration', explanation: 'The track has no usable duration.' };
  }
  if (!Array.isArray(beats) || beats.length === 0) {
    return { ok: false, reason: 'missing-grid', explanation: 'This track has no imported Rekordbox beat grid.' };
  }
  if (input.sourceTag === 'PQT2') {
    return { ok: false, reason: 'estimated-grid', explanation: 'This Rekordbox grid has estimated timestamps. Import its DAT beat grid for precise sections.' };
  }
  if (!isExactSetLabGrid(beats)) {
    return { ok: false, reason: 'invalid-grid', explanation: 'This Rekordbox beat grid has invalid or missing beat positions.' };
  }

  const limit = Math.min(durationMs, mediaDurationMs);
  const downbeats = downbeatsOnly(beats);
  if (!downbeats[barCount] || downbeats[barCount].ms > limit) {
    return { ok: false, reason: 'no-window', explanation: `No complete ${barCount}-bar window fits inside the available track duration.` };
  }

  const phrases = setLabPhraseIntervals(input.phrases ?? [], beats, durationMs);
  const windows: ResolvedSetLabSection[] = [];
  for (let i = 0; i + barCount < downbeats.length; i += 1) {
    const startDownbeat = downbeats[i];
    const endDownbeat = downbeats[i + barCount];
    const startMs = startDownbeat.ms;
    const endMs = endDownbeat.ms;
    if (endMs > limit) break;

    const overlaps = phrases.filter((phrase) => phrase.startMs < endMs && phrase.endMs > startMs);
    const phrase = overlaps.length === 1 && overlaps[0].startMs <= startMs && overlaps[0].endMs >= endMs
      ? overlaps[0] : null;
    const cueEvidence = evidenceForCue(input.cues ?? [], startMs);
    let quality: ResolvedSetLabSection['quality'] = 'grid-only';
    let explanation = 'Aligned to the Rekordbox grid without a confirmed phrase or cue.';
    if (!phrase && overlaps.length > 0) {
      quality = 'mixed';
      explanation = 'This window crosses a phrase boundary and has no single phrase identity.';
    } else if (phrase?.semantic.evidence === 'pssi-conflict') {
      quality = 'pssi-conflict';
      explanation = 'The PSSI mappings disagree, so this window has no confirmed phrase type.';
    } else if (cueEvidence) {
      quality = 'cue-aligned';
      explanation = `Aligned to a Rekordbox ${cueEvidence.family} cue.`;
    } else if (phrase?.semantic.type) {
      quality = 'phrase-aligned';
      explanation = `Fits inside ${phrase.semantic.type} ${phrase.occurrence} on the Rekordbox grid.`;
    }
    windows.push({
      section: {
        startMs, endMs, startBeat: startDownbeat.seq, endBeatExclusive: endDownbeat.seq,
        phraseType: phrase?.semantic.type ?? null, phraseOccurrence: phrase?.occurrence ?? null,
      },
      barCount, startDownbeat, endDownbeat, relativePosition: startMs / durationMs,
      phraseId: phrase?.id ?? null, cueEvidence, quality, explanation,
    });
  }
  return { ok: true, windows };
}

const priority = (window: ResolvedSetLabSection): number => {
  if (window.quality === 'mixed') return 3;
  if (window.cueEvidence) return 0;
  return window.section.phraseType ? 1 : 2;
};

/** Pick randomly within the best evidence tier. Pass a seeded RNG for reproducible choices. */
export function resolveInitialSetLabSection(
  input: SetLabSectionInput,
  barCount: SetLabBarCount = DEFAULT_SET_LAB_BAR_COUNT,
  random: () => number = Math.random,
): SectionResult {
  const result = listSetLabSections(input, barCount);
  if (result.ok === false) return result;
  const best = result.windows.reduce((rank, window) => Math.min(rank, priority(window)), Infinity);
  const choices = result.windows.filter((window) => priority(window) === best);
  const sample = random();
  if (!(sample >= 0 && sample < 1)) throw new RangeError('Set Lab RNG must return a number in [0, 1).');
  return { ok: true, window: choices[Math.floor(sample * choices.length)] };
}

/** Manual positioning allows mixed windows. Ties snap to the earlier valid downbeat. */
export function snapSetLabSection(
  input: SetLabSectionInput,
  requestedStartMs: number,
  barCount: SetLabBarCount = DEFAULT_SET_LAB_BAR_COUNT,
): SectionResult | { ok: false; reason: 'invalid-position'; explanation: string } {
  if (!Number.isFinite(requestedStartMs)) {
    return { ok: false, reason: 'invalid-position', explanation: 'The requested position must be a valid timestamp.' };
  }
  const result = listSetLabSections(input, barCount);
  if (result.ok === false) return result;
  return { ok: true, window: nearestSetLabWindow(result.windows, requestedStartMs)! };
}

/** Snap within an already verified set of windows, including media bounds. */
export function nearestSetLabWindow(windows: readonly ResolvedSetLabSection[], requestedStartMs: number): ResolvedSetLabSection | null {
  if (!windows.length || !Number.isFinite(requestedStartMs)) return null;
  return windows.reduce((best, candidate) => {
    const distance = Math.abs(candidate.section.startMs - requestedStartMs);
    const bestDistance = Math.abs(best.section.startMs - requestedStartMs);
    return distance < bestDistance || (distance === bestDistance && candidate.section.startMs < best.section.startMs)
      ? candidate : best;
  });
}

export interface SetLabReplacementReference {
  phraseType: string | null;
  phraseOccurrence: number | null;
  barCount: SetLabBarCount;
  /** Optional fraction of the old track's duration. Absolute source times are never used. */
  relativePosition?: number;
}

export type SetLabReplacementResult =
  | SectionFailure
  | { ok: true; window: ResolvedSetLabSection; match: 'same-occurrence' | 'same-type' | 'nearest-window'; explanation: string };

export function resolveSetLabReplacementSection(input: SetLabSectionInput, reference: SetLabReplacementReference): SetLabReplacementResult {
  const result = listSetLabSections(input, reference.barCount);
  return result.ok === false ? result : chooseSetLabReplacementWindow(result.windows, reference);
}

/** Use only the windows already verified against the candidate's actual audio. */
export function chooseSetLabReplacementWindow(
  windows: readonly ResolvedSetLabSection[], reference: SetLabReplacementReference,
): SetLabReplacementResult {
  const candidates = windows.filter((window) => window.barCount === reference.barCount);
  if (!candidates.length) return { ok: false, reason: 'no-window', explanation: 'No verified window fits the original bar count.' };
  const type = setLabPhraseType(reference.phraseType);
  const sameType = type ? candidates.filter((window) => window.section.phraseType === type) : [];
  const exact = reference.phraseOccurrence == null ? [] : sameType.filter(
    (window) => window.section.phraseOccurrence === reference.phraseOccurrence,
  );
  const relative = reference.relativePosition;
  const distance = (window: ResolvedSetLabSection) => relative != null && relative >= 0 && relative <= 1
    ? Math.abs(window.relativePosition - relative) : 0;
  const choose = (windows: ResolvedSetLabSection[]) => [...windows].sort((a, b) =>
    Number(a.quality === 'mixed') - Number(b.quality === 'mixed')
    || distance(a) - distance(b) || priority(a) - priority(b))[0];

  if (exact.length > 0) {
    return { ok: true, window: choose(exact), match: 'same-occurrence', explanation: `Kept ${type} ${reference.phraseOccurrence}.` };
  }
  if (sameType.length > 0) {
    return {
      ok: true, window: choose(sameType), match: 'same-type',
      explanation: reference.phraseOccurrence == null
        ? `Kept the ${type} phrase type.`
        : `${type} ${reference.phraseOccurrence} could not fit. Used another ${type} window.`,
    };
  }
  return {
    ok: true, window: choose(candidates), match: 'nearest-window',
    explanation: type ? `No ${type} window fits. Used another downbeat-aligned section.`
      : 'The original section had no confirmed phrase type. Used a downbeat-aligned section.',
  };
}
