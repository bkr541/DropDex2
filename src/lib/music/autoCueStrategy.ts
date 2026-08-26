import {
  beatAtOrBefore,
  beatByBarOffset,
  downbeatsOnly,
  exactBeatForBoundary,
  firstValidBeat,
  isUsableBeatGrid,
  nearestBeat,
  type BeatEntry,
} from './beatGridHelpers';
import {
  inspectHotCueSlotOwnership,
  replaceWorkingCues,
  type WorkingCue,
} from './cueEditorState';
import type { PhraseRow, VocalAnalysisRow, VocalRegionRow } from '../queries/analysisData';

export const AUTO_CUE_STRATEGY_VERSION = 'dropdex-djcues-a-h-v3-parity';

export const AUTO_CUE_STRATEGY_SETTINGS = Object.freeze({
  mode: 'fill-empty-slots',
  loopBars: 4,
  memoryLeadBars: 16,
  dropSearchStartFraction: 0.20,
  cueCFallback: 'phrase-then-16-bars-before-drop',
  cueFFallback: 'phrase-chorus-after-e-or-d',
  pvdi: 'optional-pvdi-v1',
  pvdiStrongThreshold: 3,
  pvdiPositiveContinuation: 0,
  pvdiMinimumRegionMs: 2000,
  pvdiPhraseToleranceBars: 4,
  colorContract: 'djcues-slot-colors-v1',
});

export type PssiCueSemantic =
  | 'Intro'
  | 'Up'
  | 'Down'
  | 'Chorus'
  | 'Outro'
  | 'Verse1'
  | 'Verse2'
  | 'Verse3'
  | 'Verse4'
  | 'Verse5'
  | 'Verse6'
  | 'Bridge'
  | 'Unknown';

export type AutoCueSemantic =
  | 'First Beat'
  | 'Loop In'
  | 'Vocal / Buildup'
  | 'Drop'
  | 'Breakdown'
  | 'Special / energy recovery'
  | 'Outro'
  | 'Loop Out';

export type AutoCueSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface SlotContract {
  slot: AutoCueSlot;
  letter: string;
  semantic: AutoCueSemantic;
  rekordboxKind: number;
  loop: boolean;
  hotColorTableIndex: number;
  colorName: 'Red' | 'Orange' | 'Yellow' | 'Green' | 'Aqua' | 'Blue' | 'Purple';
  colorHex: string;
  pairedMemory: boolean;
  memoryOffsetBars: number;
  memoryPointType: 'cue' | 'loop';
  memoryRekordboxColor: number;
  memoryColorTableIndex: number | null;
}

// Authoritative DropDex/DJcues A-H contract. Hot colors are Rekordbox
// ColorTableIndex values. Memory colors are the independent DjmdCue.Color
// encoding from rekordboxCueColorCodec; never translate one integer into the other.
export const AUTO_CUE_SLOT_CONTRACTS: readonly SlotContract[] = Object.freeze([
  { slot: 1, letter: 'A', semantic: 'First Beat', rekordboxKind: 1, loop: false, hotColorTableIndex: 18, colorName: 'Green', colorHex: '#00FF00', pairedMemory: true, memoryOffsetBars: 0, memoryPointType: 'cue', memoryRekordboxColor: 4, memoryColorTableIndex: null },
  { slot: 2, letter: 'B', semantic: 'Loop In', rekordboxKind: 2, loop: true, hotColorTableIndex: 18, colorName: 'Green', colorHex: '#00FF00', pairedMemory: true, memoryOffsetBars: 0, memoryPointType: 'loop', memoryRekordboxColor: 4, memoryColorTableIndex: 0 },
  { slot: 3, letter: 'C', semantic: 'Vocal / Buildup', rekordboxKind: 3, loop: false, hotColorTableIndex: 32, colorName: 'Yellow', colorHex: '#FFFF00', pairedMemory: true, memoryOffsetBars: 16, memoryPointType: 'cue', memoryRekordboxColor: 3, memoryColorTableIndex: null },
  { slot: 4, letter: 'D', semantic: 'Drop', rekordboxKind: 5, loop: false, hotColorTableIndex: 42, colorName: 'Red', colorHex: '#FF0000', pairedMemory: true, memoryOffsetBars: 16, memoryPointType: 'cue', memoryRekordboxColor: 1, memoryColorTableIndex: null },
  { slot: 5, letter: 'E', semantic: 'Breakdown', rekordboxKind: 6, loop: false, hotColorTableIndex: 1, colorName: 'Blue', colorHex: '#0000FF', pairedMemory: true, memoryOffsetBars: 16, memoryPointType: 'cue', memoryRekordboxColor: 6, memoryColorTableIndex: null },
  { slot: 6, letter: 'F', semantic: 'Special / energy recovery', rekordboxKind: 7, loop: false, hotColorTableIndex: 56, colorName: 'Purple', colorHex: '#8000FF', pairedMemory: true, memoryOffsetBars: 16, memoryPointType: 'cue', memoryRekordboxColor: 7, memoryColorTableIndex: null },
  { slot: 7, letter: 'G', semantic: 'Outro', rekordboxKind: 8, loop: false, hotColorTableIndex: 9, colorName: 'Aqua', colorHex: '#00FFFF', pairedMemory: true, memoryOffsetBars: 16, memoryPointType: 'cue', memoryRekordboxColor: 5, memoryColorTableIndex: null },
  { slot: 8, letter: 'H', semantic: 'Loop Out', rekordboxKind: 9, loop: true, hotColorTableIndex: 0, colorName: 'Orange', colorHex: '#FF8000', pairedMemory: true, memoryOffsetBars: 0, memoryPointType: 'loop', memoryRekordboxColor: 2, memoryColorTableIndex: 0 },
]);

export interface AdaptedPhrase {
  row: PhraseRow;
  semantic: PssiCueSemantic;
  beat: BeatEntry | null;
}

export interface AutoCueProposal {
  slot: AutoCueSlot;
  semantic: AutoCueSemantic;
  rekordboxKind: number;
  startBeat: BeatEntry;
  endBeat: BeatEntry | null;
  memoryBeat: BeatEntry | null;
  memoryEndBeat: BeatEntry | null;
  reason: string;
}

export interface AutoCueStrategyResult {
  proposals: AutoCueProposal[];
  skipped: Partial<Record<AutoCueSlot, string>>;
}

export interface AutoCueMergeResult {
  cues: WorkingCue[];
  addedHotCount: number;
  addedMemoryCount: number;
  preservedOccupiedSlots: AutoCueSlot[];
  skippedSlots: Partial<Record<AutoCueSlot, string>>;
  blockedReason: string | null;
}

const HIGH_KIND_MAP: Readonly<Record<number, PssiCueSemantic>> = Object.freeze({
  1: 'Intro',
  2: 'Up',
  3: 'Down',
  5: 'Chorus',
  6: 'Outro',
});

const MID_KIND_MAP: Readonly<Record<number, PssiCueSemantic>> = Object.freeze({
  1: 'Intro',
  2: 'Verse1',
  3: 'Verse2',
  4: 'Verse3',
  5: 'Verse4',
  6: 'Verse5',
  7: 'Verse6',
  8: 'Bridge',
  9: 'Chorus',
  10: 'Outro',
});

const LOW_KIND_MAP: Readonly<Record<number, PssiCueSemantic>> = Object.freeze({
  1: 'Intro',
  2: 'Verse1',
  3: 'Verse1',
  4: 'Verse1',
  5: 'Verse2',
  6: 'Verse2',
  7: 'Verse2',
  8: 'Bridge',
  9: 'Chorus',
  10: 'Outro',
});

function parseRawInteger(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Map raw Rekordbox PSSI mood/kind values using DJCues semantics. */
export function mapRawPssiCueSemantic(sourceMood: string | null, sourceKind: string | null): PssiCueSemantic {
  const mood = parseRawInteger(sourceMood);
  const kind = parseRawInteger(sourceKind);
  if (mood == null || kind == null) return 'Unknown';
  if (mood === 1) return HIGH_KIND_MAP[kind] ?? 'Unknown';
  if (mood === 2) return MID_KIND_MAP[kind] ?? 'Unknown';
  if (mood === 3) return LOW_KIND_MAP[kind] ?? 'Unknown';
  return 'Unknown';
}

export function adaptRawPssiPhrases(phrases: PhraseRow[], beats: BeatEntry[]): AdaptedPhrase[] {
  return phrases
    .map((row) => ({
      row,
      semantic: mapRawPssiCueSemantic(row.source_mood, row.source_kind),
      beat: exactBeatForBoundary(beats, { beatSequence: row.start_beat, ms: row.start_ms }),
    }))
    .sort((a, b) => {
      const aMs = a.beat?.ms ?? Number.POSITIVE_INFINITY;
      const bMs = b.beat?.ms ?? Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      return a.row.phrase_index - b.row.phrase_index;
    });
}

function slotContract(slot: AutoCueSlot): SlotContract {
  return AUTO_CUE_SLOT_CONTRACTS[slot - 1];
}

function validPhrases(phrases: AdaptedPhrase[]): Array<AdaptedPhrase & { beat: BeatEntry }> {
  return phrases.filter((phrase): phrase is AdaptedPhrase & { beat: BeatEntry } => phrase.beat != null);
}

function isVerse(semantic: PssiCueSemantic): boolean {
  return semantic.startsWith('Verse');
}

function proposal(
  slot: AutoCueSlot,
  startBeat: BeatEntry,
  reason: string,
  beats: BeatEntry[],
): AutoCueProposal | null {
  const contract = slotContract(slot);
  const endBeat = contract.loop
    ? beatByBarOffset(beats, startBeat, AUTO_CUE_STRATEGY_SETTINGS.loopBars)
    : null;
  if (contract.loop && !endBeat) return null;

  let memoryBeat: BeatEntry | null = null;
  if (contract.pairedMemory) {
    memoryBeat = contract.memoryOffsetBars === 0
      ? startBeat
      : beatByBarOffset(beats, startBeat, -contract.memoryOffsetBars) ?? firstValidBeat(beats);
  }
  const memoryEndBeat = contract.memoryPointType === 'loop' ? endBeat : null;

  return {
    slot,
    semantic: contract.semantic,
    rekordboxKind: contract.rekordboxKind,
    startBeat,
    endBeat,
    memoryBeat,
    memoryEndBeat,
    reason,
  };
}

function inferDurationMs(durationMs: number | null, beats: BeatEntry[]): number {
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) return durationMs;
  return beats[beats.length - 1]?.ms ?? 0;
}

function phraseFallbackC(
  beats: BeatEntry[],
  adapted: Array<AdaptedPhrase & { beat: BeatEntry }>,
  d: AutoCueProposal,
): AutoCueProposal | null {
  const phrasesBeforeD = adapted.filter((phrase) => phrase.beat.ms < d.startBeat.ms);
  const preferredC = [...phrasesBeforeD].reverse().find(
    (phrase) => phrase.semantic === 'Up' || isVerse(phrase.semantic),
  ) ?? null;
  const anyPhraseBeforeD = phrasesBeforeD[phrasesBeforeD.length - 1] ?? null;
  const fallbackBeat = beatByBarOffset(beats, d.startBeat, -AUTO_CUE_STRATEGY_SETTINGS.memoryLeadBars);
  const cAnchor = preferredC?.beat ?? anyPhraseBeforeD?.beat ?? fallbackBeat;
  if (!cAnchor) return null;
  const reason = preferredC
    ? 'Last Up/Verse phrase before D.'
    : anyPhraseBeforeD
      ? 'Last valid phrase boundary before D.'
      : 'No phrase exists before D; used the exact beat 16 bars before D.';
  return proposal(3, cAnchor, reason, beats);
}

function isFiniteVocalRegion(region: VocalRegionRow): boolean {
  return Number.isFinite(region.start_frame)
    && Number.isFinite(region.end_frame_exclusive)
    && Number.isFinite(region.start_ms)
    && Number.isFinite(region.end_ms)
    && Number.isFinite(region.duration_ms)
    && Number.isFinite(region.peak_confidence)
    && region.start_frame >= 0
    && region.end_frame_exclusive > region.start_frame
    && region.start_ms >= 0
    && region.end_ms > region.start_ms
    && region.duration_ms > 0;
}

function phraseWithinPvdiTolerance(onsetBeat: BeatEntry, phraseBeat: BeatEntry): boolean {
  if (onsetBeat.bar > 0 && phraseBeat.bar > 0) {
    return Math.abs(onsetBeat.bar - phraseBeat.bar) <= AUTO_CUE_STRATEGY_SETTINGS.pvdiPhraseToleranceBars;
  }
  return Math.abs(onsetBeat.seq - phraseBeat.seq) <= AUTO_CUE_STRATEGY_SETTINGS.pvdiPhraseToleranceBars * 4;
}

function pvdiC(
  beats: BeatEntry[],
  adapted: Array<AdaptedPhrase & { beat: BeatEntry }>,
  d: AutoCueProposal,
  vocalAnalysis: VocalAnalysisRow | null | undefined,
): AutoCueProposal | null {
  if (
    !vocalAnalysis
    || vocalAnalysis.source_tag !== 'PVDI'
    || vocalAnalysis.integrity_status !== 'valid'
    || !vocalAnalysis.complete
  ) return null;

  // PVDI parsing emits strong-onset regions in source-frame order. Preserve the
  // DJCues rule: the first strong onset is the candidate; a short/late first
  // region falls back rather than silently skipping ahead to a different vocal.
  const firstRegion = [...vocalAnalysis.regions]
    .filter(isFiniteVocalRegion)
    .sort((a, b) => a.start_frame - b.start_frame)[0] ?? null;
  if (
    !firstRegion
    || firstRegion.duration_ms < AUTO_CUE_STRATEGY_SETTINGS.pvdiMinimumRegionMs
    || firstRegion.start_ms >= d.startBeat.ms
  ) return null;

  const onsetBeat = nearestBeat(beats, firstRegion.start_ms);
  if (!onsetBeat) return null;

  const nearestPhrase = adapted
    .filter((phrase) => phrase.beat.ms < d.startBeat.ms)
    .filter((phrase) => phraseWithinPvdiTolerance(onsetBeat, phrase.beat))
    .sort((a, b) => {
      const aDistance = Math.abs(a.beat.ms - firstRegion.start_ms);
      const bDistance = Math.abs(b.beat.ms - firstRegion.start_ms);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return a.beat.ms - b.beat.ms;
    })[0] ?? null;

  if (nearestPhrase) {
    return proposal(
      3,
      nearestPhrase.beat,
      'First valid PVDI vocal onset normalized to a nearby phrase boundary within four bars.',
      beats,
    );
  }

  const downbeat = beatAtOrBefore(downbeatsOnly(beats), onsetBeat.ms) ?? onsetBeat;
  return proposal(
    3,
    downbeat,
    'First valid PVDI vocal onset normalized to the exact Rekordbox downbeat/grid.',
    beats,
  );
}

/**
 * Pure DJCues-compatible A-H proposal engine. It consumes exact beat-grid
 * timing, raw PSSI phrase values, and optional compact PVDI vocal evidence.
 * It never reads/writes persistence.
 */
export function generateAutoCueProposals(input: {
  beats: BeatEntry[];
  phrases: PhraseRow[];
  durationMs: number | null;
  vocalAnalysis?: VocalAnalysisRow | null;
}): AutoCueStrategyResult {
  const { beats } = input;
  const skipped: Partial<Record<AutoCueSlot, string>> = {};
  if (!isUsableBeatGrid(beats)) {
    for (let slot = 1; slot <= 8; slot += 1) {
      skipped[slot as AutoCueSlot] = 'No valid exact Rekordbox beat grid.';
    }
    return { proposals: [], skipped };
  }

  const adapted = validPhrases(adaptRawPssiPhrases(input.phrases, beats));
  const proposals: AutoCueProposal[] = [];
  const firstBeat = firstValidBeat(beats);

  if (firstBeat) {
    proposals.push(proposal(1, firstBeat, 'First valid exact Rekordbox beat.', beats)!);
    const b = proposal(2, firstBeat, 'Four-bar loop from the first valid beat.', beats);
    if (b) proposals.push(b);
    else skipped[2] = 'A four-bar loop endpoint is not available on the exact beat grid.';
  } else {
    skipped[1] = 'No valid exact Rekordbox beat exists.';
    skipped[2] = 'No valid exact Rekordbox beat exists.';
  }

  const durationMs = inferDurationMs(input.durationMs, beats);
  const dropThresholdMs = durationMs * AUTO_CUE_STRATEGY_SETTINGS.dropSearchStartFraction;
  const choruses = adapted.filter((phrase) => phrase.semantic === 'Chorus');
  const qualifyingChorus = choruses.find((phrase) => phrase.beat.ms >= dropThresholdMs) ?? null;

  let dPhrase: (AdaptedPhrase & { beat: BeatEntry }) | null = qualifyingChorus;
  let dReason = 'First Chorus at or after 20% of track duration.';
  if (!dPhrase && choruses.length > 0) {
    const lastEarlyChorus = choruses[choruses.length - 1];
    const upAfterEarlyChorus = adapted.find(
      (phrase) => phrase.semantic === 'Up' && phrase.beat.ms > lastEarlyChorus.beat.ms,
    ) ?? null;
    if (upAfterEarlyChorus) {
      dPhrase = upAfterEarlyChorus;
      dReason = 'All Chorus candidates were early; used the first Up after the last early Chorus.';
    } else {
      dPhrase = lastEarlyChorus;
      dReason = 'All Chorus candidates were early and no later Up existed; used the last Chorus.';
    }
  }

  const d = dPhrase ? proposal(4, dPhrase.beat, dReason, beats) : null;
  if (d) proposals.push(d);
  else skipped[4] = 'No Chorus candidate exists; Drop was not fabricated.';

  if (d) {
    const c = pvdiC(beats, adapted, d, input.vocalAnalysis) ?? phraseFallbackC(beats, adapted, d);
    if (c) proposals.push(c);
    else skipped[3] = 'No safe exact pre-D phrase or 16-bar fallback exists.';
  } else {
    skipped[3] = 'Cue C requires a safely resolved D anchor in phrase-fallback mode.';
  }

  const downOrBridge = adapted.filter((phrase) => phrase.semantic === 'Down' || phrase.semantic === 'Bridge');
  let ePhrase: (AdaptedPhrase & { beat: BeatEntry }) | null = null;
  let eReason = '';
  if (d) {
    ePhrase = downOrBridge.find((phrase) => phrase.beat.ms > d.startBeat.ms) ?? null;
    eReason = 'First Down/Bridge after D.';
  } else if (downOrBridge.length > 0) {
    ePhrase = downOrBridge[0];
    eReason = 'D is unavailable; used the first Down/Bridge as the conservative breakdown fallback.';
  }
  const e = ePhrase ? proposal(5, ePhrase.beat, eReason, beats) : null;
  if (e) proposals.push(e);
  else skipped[5] = d
    ? 'No Down/Bridge exists after D.'
    : 'No Down/Bridge phrase exists.';

  const fBase = e?.startBeat ?? d?.startBeat ?? null;
  if (fBase) {
    const recoveryChorus = choruses.find((phrase) => phrase.beat.ms > fBase.ms) ?? null;
    if (recoveryChorus) {
      const f = proposal(
        6,
        recoveryChorus.beat,
        e
          ? 'No dedicated deterministic energy summary is exposed here; used first Chorus after E.'
          : 'No dedicated deterministic energy summary is exposed here; used first Chorus after D.',
        beats,
      );
      if (f) proposals.push(f);
    } else {
      skipped[6] = 'No Chorus exists after the E/D recovery anchor.';
    }
  } else {
    skipped[6] = 'No E or D anchor exists for the phrase-based energy-recovery fallback.';
  }

  const firstOutro = adapted.find((phrase) => phrase.semantic === 'Outro') ?? null;
  const lastBoundary = adapted[adapted.length - 1] ?? null;
  const gPhrase = firstOutro ?? lastBoundary;
  const g = gPhrase
    ? proposal(
      7,
      gPhrase.beat,
      firstOutro ? 'First Outro phrase.' : 'No Outro exists; used the last valid phrase boundary.',
      beats,
    )
    : null;
  if (g) proposals.push(g);
  else skipped[7] = 'No valid phrase boundary exists for the outro cue.';

  if (g) {
    const h = proposal(8, g.startBeat, 'Four-bar loop from the G outro anchor.', beats);
    if (h) proposals.push(h);
    else skipped[8] = 'The G anchor does not have a four-bar loop endpoint on the exact beat grid.';
  } else {
    skipped[8] = 'Cue H requires a valid G anchor.';
  }

  proposals.sort((a, b) => a.slot - b.slot);
  return { proposals, skipped };
}

function makeAutoWorkingCue(
  trackId: string,
  importId: string | null,
  proposalItem: AutoCueProposal,
): WorkingCue {
  const contract = slotContract(proposalItem.slot);
  return {
    editorId: `auto:${AUTO_CUE_STRATEGY_VERSION}:hot:${trackId}:${contract.letter}`,
    trackId,
    importId,
    importedCueId: null,
    rekordboxCueId: null,
    dedupeKey: null,
    family: 'hot',
    hotCueSlot: proposalItem.slot,
    pointType: contract.loop ? 'loop' : 'cue',
    startMs: proposalItem.startBeat.ms,
    endMs: proposalItem.endBeat?.ms ?? null,
    colorTableIndex: contract.hotColorTableIndex,
    colorHex: contract.colorHex,
    colorName: contract.colorName,
    rekordboxColor: null,
    comment: `Auto Cue ${contract.letter} · ${contract.semantic}`,
    isActiveLoop: contract.loop ? false : null,
    beatLoopNumerator: contract.loop ? AUTO_CUE_STRATEGY_SETTINGS.loopBars * 4 : null,
    beatLoopDenominator: contract.loop ? 1 : null,
    sourceDbPresent: false,
    sourceAnlzPresent: false,
    sourceConflict: false,
    sourceKind: `auto:${AUTO_CUE_STRATEGY_VERSION}`,
    rekordboxKind: contract.rekordboxKind,
    semantic: contract.semantic,
    pairedHotCueSlot: null,
    strategyVersion: AUTO_CUE_STRATEGY_VERSION,
    strategySettings: { ...AUTO_CUE_STRATEGY_SETTINGS },
    source: 'auto',
  };
}

function makeMemoryWorkingCue(
  trackId: string,
  importId: string | null,
  proposalItem: AutoCueProposal,
): WorkingCue | null {
  if (!proposalItem.memoryBeat) return null;
  const contract = slotContract(proposalItem.slot);
  return {
    editorId: `auto:${AUTO_CUE_STRATEGY_VERSION}:memory:${trackId}:${contract.letter}`,
    trackId,
    importId,
    importedCueId: null,
    rekordboxCueId: null,
    dedupeKey: null,
    family: 'memory',
    hotCueSlot: null,
    pointType: contract.memoryPointType,
    startMs: proposalItem.memoryBeat.ms,
    endMs: proposalItem.memoryEndBeat?.ms ?? null,
    colorTableIndex: contract.memoryColorTableIndex,
    colorHex: contract.colorHex,
    colorName: contract.colorName,
    rekordboxColor: contract.memoryRekordboxColor,
    comment: contract.memoryOffsetBars === 0
      ? `Auto Memory · paired with Hot Cue ${contract.letter}`
      : `Auto Memory · ${contract.memoryOffsetBars} bars before Hot Cue ${contract.letter}`,
    isActiveLoop: contract.memoryPointType === 'loop' ? false : null,
    beatLoopNumerator: contract.memoryPointType === 'loop' ? AUTO_CUE_STRATEGY_SETTINGS.loopBars * 4 : null,
    beatLoopDenominator: contract.memoryPointType === 'loop' ? 1 : null,
    sourceDbPresent: false,
    sourceAnlzPresent: false,
    sourceConflict: false,
    sourceKind: `auto:${AUTO_CUE_STRATEGY_VERSION}`,
    rekordboxKind: null,
    semantic: contract.semantic,
    pairedHotCueSlot: proposalItem.slot,
    strategyVersion: AUTO_CUE_STRATEGY_VERSION,
    strategySettings: { ...AUTO_CUE_STRATEGY_SETTINGS, pairedMemoryOffsetBars: contract.memoryOffsetBars },
    source: 'auto',
  };
}

/** Fill only empty A-H slots and add each generated Hot Cue's true paired Memory cue/loop. */
export function mergeAutoCueProposals(input: {
  trackId: string;
  importId: string | null;
  currentCues: WorkingCue[];
  result: AutoCueStrategyResult;
}): AutoCueMergeResult {
  const ownership = inspectHotCueSlotOwnership(input.currentCues);
  if (ownership.status !== 'valid') {
    return {
      cues: input.currentCues,
      addedHotCount: 0,
      addedMemoryCount: 0,
      preservedOccupiedSlots: [],
      skippedSlots: input.result.skipped,
      blockedReason: ownership.error ?? 'Hot Cue ownership is not safe for Auto Cue.',
    };
  }

  const occupiedSlots = new Set(
    input.currentCues
      .filter((cue) => cue.family === 'hot' && cue.hotCueSlot != null)
      .map((cue) => cue.hotCueSlot as AutoCueSlot),
  );
  const occupiedMemoryPairs = new Set(
    input.currentCues
      .filter((cue) => cue.family === 'memory' && cue.pairedHotCueSlot != null)
      .map((cue) => cue.pairedHotCueSlot as AutoCueSlot),
  );

  const next = [...input.currentCues];
  const preservedOccupiedSlots: AutoCueSlot[] = [];
  let addedHotCount = 0;
  let addedMemoryCount = 0;

  for (const proposalItem of input.result.proposals) {
    if (occupiedSlots.has(proposalItem.slot)) {
      preservedOccupiedSlots.push(proposalItem.slot);
      continue;
    }

    next.push(makeAutoWorkingCue(input.trackId, input.importId, proposalItem));
    occupiedSlots.add(proposalItem.slot);
    addedHotCount += 1;

    const memory = makeMemoryWorkingCue(input.trackId, input.importId, proposalItem);
    if (memory?.startMs != null && !occupiedMemoryPairs.has(proposalItem.slot)) {
      next.push(memory);
      occupiedMemoryPairs.add(proposalItem.slot);
      addedMemoryCount += 1;
    }
  }

  return {
    cues: replaceWorkingCues(next),
    addedHotCount,
    addedMemoryCount,
    preservedOccupiedSlots,
    skippedSlots: input.result.skipped,
    blockedReason: null,
  };
}

export function applyAutoCueStrategy(input: {
  trackId: string;
  importId: string | null;
  durationMs: number | null;
  beats: BeatEntry[];
  phrases: PhraseRow[];
  vocalAnalysis?: VocalAnalysisRow | null;
  currentCues: WorkingCue[];
}): AutoCueMergeResult {
  const result = generateAutoCueProposals({
    beats: input.beats,
    phrases: input.phrases,
    durationMs: input.durationMs,
    vocalAnalysis: input.vocalAnalysis,
  });
  return mergeAutoCueProposals({
    trackId: input.trackId,
    importId: input.importId,
    currentCues: input.currentCues,
    result,
  });
}
