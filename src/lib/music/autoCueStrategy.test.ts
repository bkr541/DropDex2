import { describe, expect, it } from 'vitest';
import type { BeatEntry } from './beatGridHelpers';
import {
  AUTO_CUE_STRATEGY_VERSION,
  adaptRawPssiPhrases,
  applyAutoCueStrategy,
  generateAutoCueProposals,
  mapRawPssiCueSemantic,
  mergeAutoCueProposals,
} from './autoCueStrategy';
import type { WorkingCue } from './cueEditorState';
import type { PhraseRow, VocalAnalysisRow, VocalRegionRow } from '../queries/analysisData';

function makeVariableTempoBeats(barCount = 96): BeatEntry[] {
  const beats: BeatEntry[] = [];
  let ms = 0;
  for (let i = 0; i < barCount * 4; i += 1) {
    const bpm = [120, 127.5, 133, 124][i % 4];
    beats.push({
      seq: i + 1,
      srcIdx: i,
      beatInBar: (i % 4) + 1,
      bar: Math.floor(i / 4) + 1,
      ms,
      bpm,
      isDownbeat: i % 4 === 0,
    });
    ms += 60_000 / bpm;
  }
  return beats;
}

function phrase(
  index: number,
  startBeat: number,
  mood: string,
  kind: string,
  beats: BeatEntry[],
  overrides: Partial<PhraseRow> = {},
): PhraseRow {
  const beat = beats.find((item) => item.seq === startBeat)!;
  return {
    id: `phrase-${index}`,
    import_id: 'import-1',
    track_id: 'track-1',
    phrase_index: index,
    source_mood: mood,
    source_kind: kind,
    source_bank: '0',
    normalized_label: 'intentionally-not-authoritative',
    start_beat: startBeat,
    end_beat: startBeat + 4,
    start_ms: beat.ms,
    end_ms: beats.find((item) => item.seq === startBeat + 4)?.ms ?? null,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: { mood, kind },
    parser_version: 'test',
    ...overrides,
  };
}

function importedHot(slot: number, startMs: number): WorkingCue {
  return {
    editorId: `imported:${slot}`,
    trackId: 'track-1',
    importId: 'import-1',
    importedCueId: `cue-${slot}`,
    rekordboxCueId: `rb-${slot}`,
    dedupeKey: `dedupe-${slot}`,
    family: 'hot',
    hotCueSlot: slot,
    pointType: 'cue',
    startMs,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
    comment: 'manual/imported owner',
    isActiveLoop: false,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: true,
    sourceAnlzPresent: true,
    sourceConflict: false,
    sourceKind: 'PCO2',
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'imported',
  };
}


function vocalAnalysis(regions: VocalRegionRow[], overrides: Partial<VocalAnalysisRow> = {}): VocalAnalysisRow {
  return {
    id: 'vocal-1',
    import_id: 'import-1',
    track_id: 'track-1',
    source_tag: 'PVDI',
    source_header_length: 24,
    source_u1: 0x400,
    source_u2: 0x56220001,
    frame_duration_ms: 1024 / 22050 * 1000,
    frame_count: 4000,
    regions,
    integrity_status: 'valid',
    complete: true,
    parse_warnings: [],
    parser_version: '1.0.0',
    ...overrides,
  };
}

function vocalRegion(startMs: number, durationMs = 2200, startFrame = 100): VocalRegionRow {
  return {
    start_frame: startFrame,
    end_frame_exclusive: startFrame + 48,
    start_ms: startMs,
    end_ms: startMs + durationMs,
    duration_ms: durationMs,
    peak_confidence: 4,
  };
}

function representativePhrases(beats: BeatEntry[]): PhraseRow[] {
  // Mid-mood semantics: Intro, Verse1, Chorus, Bridge, Chorus, Outro.
  return [
    phrase(0, 1, '2', '1', beats),
    phrase(1, 33, '2', '2', beats),
    phrase(2, 97, '2', '9', beats),       // bar 25, first D candidate
    phrase(3, 145, '2', '8', beats),      // bar 37, E
    phrase(4, 193, '2', '9', beats),      // bar 49, F phrase fallback
    phrase(5, 289, '2', '10', beats),     // bar 73, G/H
  ];
}

describe('raw PSSI DJCues semantic adapter', () => {
  it('maps every specified High branch and preserves unknowns', () => {
    expect([1, 2, 3, 5, 6].map((kind) => mapRawPssiCueSemantic('1', String(kind))))
      .toEqual(['Intro', 'Up', 'Down', 'Chorus', 'Outro']);
    expect(mapRawPssiCueSemantic('1', '4')).toBe('Unknown');
  });

  it('maps every specified Mid branch', () => {
    expect(Array.from({ length: 10 }, (_, i) => mapRawPssiCueSemantic('2', String(i + 1))))
      .toEqual(['Intro', 'Verse1', 'Verse2', 'Verse3', 'Verse4', 'Verse5', 'Verse6', 'Bridge', 'Chorus', 'Outro']);
  });

  it('maps Low verse families exactly and does not invent semantics for malformed values', () => {
    expect(Array.from({ length: 10 }, (_, i) => mapRawPssiCueSemantic('3', String(i + 1))))
      .toEqual(['Intro', 'Verse1', 'Verse1', 'Verse1', 'Verse2', 'Verse2', 'Verse2', 'Bridge', 'Chorus', 'Outro']);
    expect(mapRawPssiCueSemantic('9', '1')).toBe('Unknown');
    expect(mapRawPssiCueSemantic('2', '99')).toBe('Unknown');
    expect(mapRawPssiCueSemantic(null, null)).toBe('Unknown');
  });

  it('uses raw mood/kind instead of the generic normalized_label and exact start_beat identity before ms', () => {
    const beats = makeVariableTempoBeats(8);
    const row = phrase(0, 9, '1', '5', beats, { normalized_label: 'verse', start_ms: beats[20].ms });
    const [adapted] = adaptRawPssiPhrases([row], beats);
    expect(adapted.semantic).toBe('Chorus');
    expect(adapted.beat?.seq).toBe(9);
  });
});

describe('DJCues-compatible A-H strategy', () => {
  it('builds representative A-H proposals and exact variable-tempo loop/memory offsets', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = representativePhrases(beats);
    const durationMs = beats[beats.length - 1].ms + 500;
    const result = generateAutoCueProposals({ beats, phrases, durationMs });
    const bySlot = new Map(result.proposals.map((item) => [item.slot, item]));

    expect([...bySlot.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bySlot.get(1)?.startBeat).toBe(beats[0]);
    expect(bySlot.get(2)?.startBeat).toBe(beats[0]);
    expect(bySlot.get(2)?.endBeat).toBe(beats[16]); // exact beat at bar +4
    expect(bySlot.get(3)?.startBeat.seq).toBe(33); // last Verse before D
    expect(bySlot.get(4)?.startBeat.seq).toBe(97);
    expect(bySlot.get(5)?.startBeat.seq).toBe(145);
    expect(bySlot.get(6)?.startBeat.seq).toBe(193);
    expect(bySlot.get(7)?.startBeat.seq).toBe(289);
    expect(bySlot.get(8)?.startBeat.seq).toBe(289);
    expect(bySlot.get(8)?.endBeat.seq).toBe(305);

    expect(bySlot.get(4)?.memoryBeat?.bar).toBe(bySlot.get(4)!.startBeat.bar - 16);
    expect(bySlot.get(5)?.memoryBeat?.bar).toBe(bySlot.get(5)!.startBeat.bar - 16);
    expect(bySlot.get(6)?.memoryBeat?.bar).toBe(bySlot.get(6)!.startBeat.bar - 16);
    expect(bySlot.get(7)?.memoryBeat?.bar).toBe(bySlot.get(7)!.startBeat.bar - 16);
    expect(bySlot.get(2)?.endBeat?.ms).toBe(beats[16].ms);
  });

  it('uses the first Chorus at/after 20%, then handles all-early Chorus with Up or last-Chorus fallback', () => {
    const beats = makeVariableTempoBeats(80);
    const durationMs = beats[beats.length - 1].ms;

    const thresholdCase = generateAutoCueProposals({
      beats,
      durationMs,
      phrases: [
        phrase(0, 17, '1', '5', beats),
        phrase(1, 81, '1', '5', beats),
      ],
    });
    expect(thresholdCase.proposals.find((item) => item.slot === 4)?.startBeat.seq).toBe(81);

    const earlyWithUp = generateAutoCueProposals({
      beats,
      durationMs,
      phrases: [
        phrase(0, 9, '1', '5', beats),
        phrase(1, 17, '1', '5', beats),
        phrase(2, 33, '1', '2', beats),
      ],
    });
    expect(earlyWithUp.proposals.find((item) => item.slot === 4)?.startBeat.seq).toBe(33);

    const earlyWithoutUp = generateAutoCueProposals({
      beats,
      durationMs,
      phrases: [
        phrase(0, 9, '1', '5', beats),
        phrase(1, 17, '1', '5', beats),
      ],
    });
    expect(earlyWithoutUp.proposals.find((item) => item.slot === 4)?.startBeat.seq).toBe(17);
  });

  it('uses C phrase fallback order and the documented exact 16-bar safe fallback when there is no earlier phrase', () => {
    const beats = makeVariableTempoBeats(80);
    const durationMs = beats[beats.length - 1].ms;

    const withAnyPriorPhrase = generateAutoCueProposals({
      beats,
      durationMs,
      phrases: [
        phrase(0, 33, '9', '9', beats), // Unknown but still a valid prior phrase boundary
        phrase(1, 129, '2', '9', beats),
      ],
    });
    expect(withAnyPriorPhrase.proposals.find((item) => item.slot === 3)?.startBeat.seq).toBe(33);

    const noPriorPhrase = generateAutoCueProposals({
      beats,
      durationMs,
      phrases: [phrase(0, 129, '2', '9', beats)], // D at bar 33
    });
    const c = noPriorPhrase.proposals.find((item) => item.slot === 3);
    const d = noPriorPhrase.proposals.find((item) => item.slot === 4)!;
    expect(c?.startBeat.bar).toBe(d.startBeat.bar - 16);
  });

  it('does not fabricate D when Chorus is absent and uses conservative E plus G/H phrase fallbacks', () => {
    const beats = makeVariableTempoBeats(80);
    const result = generateAutoCueProposals({
      beats,
      durationMs: beats[beats.length - 1].ms,
      phrases: [
        phrase(0, 65, '1', '3', beats), // Down
        phrase(1, 193, '1', '2', beats), // Up, last valid boundary; no Outro
      ],
    });
    expect(result.proposals.some((item) => item.slot === 4)).toBe(false);
    expect(result.proposals.find((item) => item.slot === 5)?.startBeat.seq).toBe(65);
    expect(result.proposals.find((item) => item.slot === 7)?.startBeat.seq).toBe(193);
    expect(result.proposals.find((item) => item.slot === 8)?.startBeat.seq).toBe(193);
    expect(result.skipped[4]).toContain('not fabricated');
  });

  it('degrades safely with no phrases or an unusable grid', () => {
    const beats = makeVariableTempoBeats(8);
    const noPhrases = generateAutoCueProposals({ beats, phrases: [], durationMs: beats.at(-1)!.ms });
    expect(noPhrases.proposals.map((item) => item.slot)).toEqual([1, 2]);
    expect(noPhrases.skipped[4]).toBeTruthy();
    expect(noPhrases.skipped[7]).toBeTruthy();

    const malformed = [beats[0], { ...beats[1], ms: -1 }];
    const noGrid = generateAutoCueProposals({ beats: malformed, phrases: [], durationMs: 1000 });
    expect(noGrid.proposals).toHaveLength(0);
    expect(Object.keys(noGrid.skipped)).toHaveLength(8);
  });
});

describe('fill-empty working-set merge', () => {
  it('preserves occupied manual/imported slots, adds only empty proposed Hot Cues, and carries writer handoff metadata', () => {
    const beats = makeVariableTempoBeats(96);
    const strategy = generateAutoCueProposals({
      beats,
      phrases: representativePhrases(beats),
      durationMs: beats.at(-1)!.ms,
    });
    const occupiedA = importedHot(1, 777);
    const occupiedD = importedHot(4, 999);
    const merged = mergeAutoCueProposals({
      trackId: 'track-1',
      importId: 'import-1',
      currentCues: [occupiedA, occupiedD],
      result: strategy,
    });

    expect(merged.cues.find((cue) => cue.editorId === occupiedA.editorId)?.startMs).toBe(777);
    expect(merged.cues.find((cue) => cue.editorId === occupiedD.editorId)?.startMs).toBe(999);
    expect(merged.preservedOccupiedSlots).toEqual([1, 4]);
    expect(merged.addedHotCount).toBe(6);
    expect(merged.cues.filter((cue) => cue.family === 'hot')).toHaveLength(8);

    const autoC = merged.cues.find((cue) => cue.family === 'hot' && cue.hotCueSlot === 3)!;
    expect(autoC).toMatchObject({
      source: 'auto',
      semantic: 'Vocal / Buildup',
      rekordboxKind: 3,
      strategyVersion: AUTO_CUE_STRATEGY_VERSION,
    });
    const memoryC = merged.cues.find((cue) => cue.family === 'memory' && cue.pairedHotCueSlot === 3);
    expect(memoryC?.source).toBe('auto');
  });

  it('fails closed instead of filling apparently free slots when imported Hot Cue ownership is unresolved', () => {
    const beats = makeVariableTempoBeats(96);
    const strategy = generateAutoCueProposals({
      beats,
      phrases: representativePhrases(beats),
      durationMs: beats.at(-1)!.ms,
    });
    const unresolved = { ...importedHot(1, 777), hotCueSlot: null };
    const merged = mergeAutoCueProposals({
      trackId: 'track-1',
      importId: 'import-1',
      currentCues: [unresolved],
      result: strategy,
    });

    expect(merged.blockedReason).toMatch(/unresolved/i);
    expect(merged.cues).toEqual([unresolved]);
    expect(merged.addedHotCount).toBe(0);
    expect(merged.addedMemoryCount).toBe(0);
  });

  it('does not add duplicate Memory cues and repeated Auto Cue runs are deterministic/idempotent under fill-empty semantics', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = representativePhrases(beats);
    const first = applyAutoCueStrategy({
      trackId: 'track-1',
      importId: 'import-1',
      durationMs: beats.at(-1)!.ms,
      beats,
      phrases,
      currentCues: [],
    });
    const second = applyAutoCueStrategy({
      trackId: 'track-1',
      importId: 'import-1',
      durationMs: beats.at(-1)!.ms,
      beats,
      phrases,
      currentCues: first.cues,
    });

    expect(second.addedHotCount).toBe(0);
    expect(second.addedMemoryCount).toBe(0);
    expect(second.cues).toEqual(first.cues);

    const memoryTimes = first.cues
      .filter((cue) => cue.family === 'memory')
      .map((cue) => cue.startMs);
    expect(new Set(memoryTimes).size).toBe(memoryTimes.length);

    const movedMemory = first.cues.map((cue) =>
      cue.family === 'memory' && cue.pairedHotCueSlot === 4
        ? { ...cue, startMs: (cue.startMs ?? 0) + 123 }
        : cue,
    );
    const withoutHotD = movedMemory.filter((cue) => !(cue.family === 'hot' && cue.hotCueSlot === 4));
    const rerunAfterHotDelete = applyAutoCueStrategy({
      trackId: 'track-1',
      importId: 'import-1',
      durationMs: beats.at(-1)!.ms,
      beats,
      phrases,
      currentCues: withoutHotD,
    });
    expect(rerunAfterHotDelete.addedHotCount).toBe(1);
    expect(rerunAfterHotDelete.cues.filter((cue) => cue.family === 'memory' && cue.pairedHotCueSlot === 4)).toHaveLength(1);
  });

  it('preserves all A-H when every slot is occupied', () => {
    const beats = makeVariableTempoBeats(96);
    const currentCues = Array.from({ length: 8 }, (_, i) => importedHot(i + 1, i * 1000));
    const merged = applyAutoCueStrategy({
      trackId: 'track-1',
      importId: 'import-1',
      durationMs: beats.at(-1)!.ms,
      beats,
      phrases: representativePhrases(beats),
      currentCues,
    });
    expect(merged.addedHotCount).toBe(0);
    expect(merged.addedMemoryCount).toBe(0);
    expect(merged.cues).toEqual(currentCues);
    expect(merged.preservedOccupiedSlots).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});


describe('Stage 8 optional PVDI Cue C enrichment', () => {
  it('uses the first meaningful pre-D vocal region and normalizes to a nearby phrase boundary', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = [
      phrase(0, 77, '2', '2', beats), // Verse at bar 20
      phrase(1, 157, '2', '9', beats), // D Chorus at bar 40
      phrase(2, 205, '2', '8', beats),
      phrase(3, 253, '2', '9', beats),
      phrase(4, 321, '2', '10', beats),
    ];
    const result = generateAutoCueProposals({
      beats,
      phrases,
      durationMs: beats.at(-1)!.ms,
      vocalAnalysis: vocalAnalysis([vocalRegion(beats[81].ms + 10)]), // bar 21, close to bar-20 phrase
    });
    const c = result.proposals.find((item) => item.slot === 3)!;
    expect(c.startBeat.seq).toBe(77);
    expect(c.reason).toContain('PVDI');
    expect(c.memoryBeat?.bar).toBe(c.startBeat.bar - 16);
  });

  it('uses an exact source downbeat when no phrase boundary is within four bars', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = [
      phrase(0, 157, '2', '9', beats), // D only; no earlier phrase boundary
      phrase(1, 205, '2', '8', beats),
      phrase(2, 253, '2', '9', beats),
      phrase(3, 321, '2', '10', beats),
    ];
    const result = generateAutoCueProposals({
      beats,
      phrases,
      durationMs: beats.at(-1)!.ms,
      vocalAnalysis: vocalAnalysis([vocalRegion(beats[77].ms + 20)]), // beat 2 of bar 20
    });
    const c = result.proposals.find((item) => item.slot === 3)!;
    expect(c.startBeat.seq).toBe(77); // exact downbeat of bar 20, not reconstructed timing
    expect(c.startBeat).toBe(beats[76]);
  });

  it('keeps the Stage 3 phrase fallback byte-for-byte equivalent when PVDI is absent, invalid, short, or after D', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = representativePhrases(beats);
    const durationMs = beats.at(-1)!.ms;
    const baseline = generateAutoCueProposals({ beats, phrases, durationMs });
    const d = baseline.proposals.find((item) => item.slot === 4)!;
    const variants: Array<VocalAnalysisRow | null> = [
      null,
      vocalAnalysis([vocalRegion(beats[48].ms)], { integrity_status: 'invalid', complete: false }),
      vocalAnalysis([vocalRegion(beats[48].ms, 500)]),
      vocalAnalysis([vocalRegion(d.startBeat.ms + 1)]),
    ];

    for (const variant of variants) {
      const result = generateAutoCueProposals({ beats, phrases, durationMs, vocalAnalysis: variant });
      expect(result.proposals).toEqual(baseline.proposals);
      expect(result.skipped).toEqual(baseline.skipped);
    }
  });

  it('does not skip past a short first strong region to a later vocal region', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = representativePhrases(beats);
    const durationMs = beats.at(-1)!.ms;
    const baseline = generateAutoCueProposals({ beats, phrases, durationMs });
    const result = generateAutoCueProposals({
      beats,
      phrases,
      durationMs,
      vocalAnalysis: vocalAnalysis([
        vocalRegion(beats[48].ms, 400, 100),
        vocalRegion(beats[60].ms, 3000, 200),
      ]),
    });
    expect(result.proposals).toEqual(baseline.proposals);
  });

  it('changes only C proposal semantics while A/B/D/E/F/G/H remain unchanged', () => {
    const beats = makeVariableTempoBeats(96);
    const phrases = representativePhrases(beats);
    const durationMs = beats.at(-1)!.ms;
    const baseline = generateAutoCueProposals({ beats, phrases, durationMs });
    const enhanced = generateAutoCueProposals({
      beats,
      phrases,
      durationMs,
      vocalAnalysis: vocalAnalysis([vocalRegion(beats[76].ms)]),
    });
    for (const slot of [1, 2, 4, 5, 6, 7, 8] as const) {
      expect(enhanced.proposals.find((item) => item.slot === slot))
        .toEqual(baseline.proposals.find((item) => item.slot === slot));
    }
  });
});
