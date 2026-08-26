import { describe, expect, it } from 'vitest';
import type { BeatEntry } from './beatGridHelpers';
import {
  addWorkingCue,
  deleteWorkingCue,
  editWorkingCue,
  hotCueSlotLabel,
  inspectHotCueSlotOwnership,
  isCurrentTrackResponse,
  moveWorkingCue,
  nextAvailableHotCueSlot,
  normalizeImportedCues,
  workingCueSetsEqual,
  DEFAULT_LOOP_BEATS,
} from './cueEditorState';
import type { CueRow } from '../queries/analysisData';

function beat(seq: number, ms: number, bpm = 128): BeatEntry {
  return {
    seq,
    srcIdx: seq - 1,
    beatInBar: ((seq - 1) % 4) + 1,
    bar: Math.floor((seq - 1) / 4) + 1,
    ms,
    bpm,
    isDownbeat: (seq - 1) % 4 === 0,
  };
}

function importedCue(overrides: Partial<CueRow> = {}): CueRow {
  return {
    id: 'cue-1',
    import_id: 'import-1',
    track_id: 'track-a',
    rekordbox_cue_id: 'rb-1',
    dedupe_key: 'dedupe-1',
    cue_family: 'hot',
    cue_family_authority: 'anlz',
    hot_cue_slot: 1,
    point_type: 'cue',
    source_kind: 'rekordbox',
    start_ms: 500,
    end_ms: null,
    color_table_index: 3,
    color_hex: '#112233',
    color_name: 'Blue',
    comment: 'Imported label',
    is_active_loop: false,
    beat_loop_numerator: null,
    beat_loop_denominator: null,
    source_db_present: true,
    source_anlz_present: true,
    source_conflict: false,
    ...overrides,
  };
}

const variableTempoBeats: BeatEntry[] = [
  beat(1, 0, 120),
  beat(2, 500, 120),
  beat(3, 980, 125),
  beat(4, 1430, 133.333),
  beat(5, 1880, 133.333),
];

const loopBeats: BeatEntry[] = Array.from({ length: 40 }, (_, index) => beat(index + 1, index * 500, 120));

describe('track-scoped async response guard', () => {
  it('rejects a late Track A response after Track B becomes active', () => {
    expect(isCurrentTrackResponse('track-b', 'track-a')).toBe(false);
    expect(isCurrentTrackResponse('track-b', 'track-b')).toBe(true);
    expect(isCurrentTrackResponse(null, 'track-a')).toBe(false);
  });
});

describe('cue editor working state', () => {
  it('normalizes imported cues without mutating source rows and preserves round-trip fields', () => {
    const row = importedCue();
    const baseline = normalizeImportedCues('track-a', [row]);

    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({
      editorId: 'imported:cue-1',
      trackId: 'track-a',
      importedCueId: 'cue-1',
      rekordboxCueId: 'rb-1',
      dedupeKey: 'dedupe-1',
      family: 'hot',
      hotCueSlot: 1,
      startMs: 500,
      colorHex: '#112233',
      comment: 'Imported label',
      source: 'imported',
    });

    baseline[0].startMs = 980;
    expect(row.start_ms).toBe(500);
  });

  it('renders only real A-H ownership as a Hot Cue letter', () => {
    expect(hotCueSlotLabel(null)).toBe('?');
    expect(hotCueSlotLabel(0)).toBe('?');
    expect(hotCueSlotLabel(9)).toBe('?');
    expect(hotCueSlotLabel(8)).toBe('H');
  });

  it('fails Hot Cue allocation closed for unresolved or duplicate imported ownership', () => {
    const unresolved = normalizeImportedCues('track-a', [importedCue({ hot_cue_slot: null })]);
    expect(inspectHotCueSlotOwnership(unresolved).status).toBe('unresolved');
    expect(nextAvailableHotCueSlot(unresolved)).toBeNull();
    const invalid = normalizeImportedCues('track-a', [importedCue({ hot_cue_slot: 9 })]);
    expect(inspectHotCueSlotOwnership(invalid).status).toBe('invalid');
    expect(nextAvailableHotCueSlot(invalid)).toBeNull();
    expect(addWorkingCue(unresolved, {
      editorId: 'manual:blocked-unresolved',
      trackId: 'track-a',
      family: 'hot',
      requestedMs: 980,
      beats: variableTempoBeats,
    })).toMatchObject({ cues: unresolved, error: expect.stringMatching(/unresolved/i) });

    const duplicate = normalizeImportedCues('track-a', [
      importedCue({ id: 'cue-a-1', hot_cue_slot: 1 }),
      importedCue({ id: 'cue-a-2', rekordbox_cue_id: 'rb-2', dedupe_key: 'dedupe-2', hot_cue_slot: 1, start_ms: 980 }),
    ]);
    expect(inspectHotCueSlotOwnership(duplicate)).toMatchObject({ status: 'invalid', error: expect.stringMatching(/Duplicate Hot Cue slot A/i) });
    expect(nextAvailableHotCueSlot(duplicate)).toBeNull();
  });

  it('adds multiple cues on exact source beat milliseconds and assigns unique A-H hot slots', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ hot_cue_slot: 1 })]);
    const hot = addWorkingCue(baseline, {
      editorId: 'manual:1',
      trackId: 'track-a',
      family: 'hot',
      requestedMs: 760,
      beats: variableTempoBeats,
    });
    expect(hot.error).toBeNull();
    expect(hot.beat?.ms).toBe(980);
    expect(hot.cues.find((cue) => cue.editorId === 'manual:1')).toMatchObject({
      family: 'hot',
      hotCueSlot: 2,
      startMs: 980,
    });

    const memory = addWorkingCue(hot.cues, {
      editorId: 'manual:2',
      trackId: 'track-a',
      family: 'memory',
      requestedMs: 1650,
      beats: variableTempoBeats,
    });
    expect(memory.error).toBeNull();
    expect(memory.cues.find((cue) => cue.editorId === 'manual:2')).toMatchObject({
      family: 'memory',
      hotCueSlot: null,
      startMs: 1430,
    });
    expect(memory.cues).toHaveLength(3);
  });

  it('refuses a ninth hot cue rather than duplicating active A-H ownership', () => {
    const rows = Array.from({ length: 8 }, (_, index) => importedCue({
      id: `cue-${index + 1}`,
      rekordbox_cue_id: `rb-${index + 1}`,
      dedupe_key: `dedupe-${index + 1}`,
      hot_cue_slot: index + 1,
      start_ms: index * 100,
    }));
    const baseline = normalizeImportedCues('track-a', rows);
    expect(nextAvailableHotCueSlot(baseline)).toBeNull();

    const result = addWorkingCue(baseline, {
      editorId: 'manual:9',
      trackId: 'track-a',
      family: 'hot',
      requestedMs: 500,
      beats: variableTempoBeats,
    });
    expect(result.error).toContain('A–H');
    expect(result.cues).toBe(baseline);
  });

  it('moves point cues by exact variable-tempo beat positions', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ start_ms: 500 })]);
    const result = moveWorkingCue(baseline, 'imported:cue-1', 1200, variableTempoBeats);
    expect(result.error).toBeNull();
    expect(result.beat?.ms).toBe(980);
    expect(result.cues[0].startMs).toBe(980);
  });

  it('moves loop start and end to exact beats while preserving its beat length', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({
      point_type: 'loop',
      start_ms: 500,
      end_ms: 1430,
    })]);
    const result = moveWorkingCue(baseline, 'imported:cue-1', 900, variableTempoBeats);
    expect(result.error).toBeNull();
    expect(result.cues[0].startMs).toBe(980);
    expect(result.cues[0].endMs).toBe(1880);
  });

  it('fails closed for malformed grids and impossible loop ranges', () => {
    const malformed = [beat(1, 500), beat(2, 400)];
    const baseline = normalizeImportedCues('track-a', [importedCue()]);
    expect(addWorkingCue(baseline, {
      editorId: 'manual:bad',
      trackId: 'track-a',
      family: 'memory',
      requestedMs: 450,
      beats: malformed,
    }).error).toContain('no valid Rekordbox beat grid');

    const loop = normalizeImportedCues('track-a', [importedCue({
      point_type: 'loop',
      start_ms: 980,
      end_ms: 1880,
    })]);
    expect(moveWorkingCue(loop, 'imported:cue-1', 1880, variableTempoBeats).error).toContain('extend beyond');
  });

  it('derives dirty state from canonical content and Discard can restore the baseline exactly', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue()]);
    const moved = moveWorkingCue(baseline, 'imported:cue-1', 1000, variableTempoBeats).cues;
    expect(workingCueSetsEqual(baseline, moved)).toBe(false);

    const afterDelete = deleteWorkingCue(moved, 'imported:cue-1');
    expect(afterDelete).toHaveLength(0);
    expect(workingCueSetsEqual(baseline, afterDelete)).toBe(false);

    const discarded = baseline;
    expect(workingCueSetsEqual(baseline, discarded)).toBe(true);
  });

  it('changes Hot Cue slots only when the target A-H ownership is free', () => {
    const baseline = normalizeImportedCues('track-a', [
      importedCue({ id: 'cue-a', hot_cue_slot: 1 }),
      importedCue({ id: 'cue-b', rekordbox_cue_id: 'rb-b', dedupe_key: 'dedupe-b', hot_cue_slot: 2, start_ms: 1000 }),
    ]);

    const collision = editWorkingCue(baseline, 'imported:cue-a', { kind: 'hot-slot', hotCueSlot: 2 });
    expect(collision.error).toContain('already in use');
    expect(collision.cues).toBe(baseline);

    const changed = editWorkingCue(baseline, 'imported:cue-a', { kind: 'hot-slot', hotCueSlot: 4 });
    expect(changed.error).toBeNull();
    expect(changed.cues.find((cue) => cue.editorId === 'imported:cue-a')).toMatchObject({
      family: 'hot',
      hotCueSlot: 4,
      rekordboxKind: 5,
    });
  });

  it('keeps rapid family and slot changes collision-safe', () => {
    const baseline = normalizeImportedCues('track-a', [
      importedCue({ id: 'cue-a', hot_cue_slot: 1 }),
      importedCue({ id: 'cue-b', rekordbox_cue_id: 'rb-b', dedupe_key: 'dedupe-b', hot_cue_slot: 2, start_ms: 1000 }),
    ]);

    const memory = editWorkingCue(baseline, 'imported:cue-a', { kind: 'family', family: 'memory' });
    const hotC = editWorkingCue(memory.cues, 'imported:cue-a', { kind: 'family', family: 'hot', hotCueSlot: 3 });
    const hotD = editWorkingCue(hotC.cues, 'imported:cue-a', { kind: 'hot-slot', hotCueSlot: 4 });
    const collision = editWorkingCue(hotD.cues, 'imported:cue-a', { kind: 'hot-slot', hotCueSlot: 2 });
    const memoryAgain = editWorkingCue(hotD.cues, 'imported:cue-a', { kind: 'family', family: 'memory' });
    const hotA = editWorkingCue(memoryAgain.cues, 'imported:cue-a', { kind: 'family', family: 'hot', hotCueSlot: 1 });

    expect(collision.error).toContain('already in use');
    expect(hotA.error).toBeNull();
    expect(inspectHotCueSlotOwnership(hotA.cues)).toMatchObject({ status: 'valid', occupiedSlots: [1, 2] });
  });

  it('converts Hot and Memory families without leaving impossible slot state', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ hot_cue_slot: 3 })]);
    const memory = editWorkingCue(baseline, 'imported:cue-1', { kind: 'family', family: 'memory' });
    expect(memory.error).toBeNull();
    expect(memory.cues[0]).toMatchObject({ family: 'memory', hotCueSlot: null, rekordboxKind: null });

    const missingSlot = editWorkingCue(memory.cues, 'imported:cue-1', { kind: 'family', family: 'hot' });
    expect(missingSlot.error).toMatch(/explicit free slot/i);

    const hot = editWorkingCue(memory.cues, 'imported:cue-1', { kind: 'family', family: 'hot', hotCueSlot: 8 });
    expect(hot.error).toBeNull();
    expect(hot.cues[0]).toMatchObject({ family: 'hot', hotCueSlot: 8, rekordboxKind: 9 });
  });

  it('converts a point cue to the established four-bar loop and clears loop-only state when converted back', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ start_ms: 500 })]);
    const loop = editWorkingCue(baseline, 'imported:cue-1', { kind: 'point-type', pointType: 'loop' }, loopBeats);
    expect(loop.error).toBeNull();
    expect(loop.cues[0]).toMatchObject({
      pointType: 'loop',
      startMs: 500,
      endMs: 500 + DEFAULT_LOOP_BEATS * 500,
      isActiveLoop: false,
      beatLoopNumerator: DEFAULT_LOOP_BEATS,
      beatLoopDenominator: 1,
    });

    const point = editWorkingCue(loop.cues, 'imported:cue-1', { kind: 'point-type', pointType: 'cue' }, loopBeats);
    expect(point.error).toBeNull();
    expect(point.cues[0]).toMatchObject({
      pointType: 'cue',
      endMs: null,
      isActiveLoop: null,
      beatLoopNumerator: null,
      beatLoopDenominator: null,
    });
  });

  it('rejects impossible loop conversion and invalid loop ends', () => {
    const nearEnd = normalizeImportedCues('track-a', [importedCue({ start_ms: 19000 })]);
    expect(editWorkingCue(nearEnd, 'imported:cue-1', { kind: 'point-type', pointType: 'loop' }, loopBeats).error)
      .toContain('four-bar loop');

    const loop = normalizeImportedCues('track-a', [importedCue({ point_type: 'loop', start_ms: 1000, end_ms: 3000 })]);
    expect(editWorkingCue(loop, 'imported:cue-1', { kind: 'end-ms', requestedMs: 500, timingMode: 'exact' }, loopBeats).error)
      .toContain('after loop start');
    expect(editWorkingCue(loop, 'imported:cue-1', { kind: 'loop-length-ms', requestedMs: 0, timingMode: 'exact' }, loopBeats).error)
      .toContain('after loop start');
    expect(editWorkingCue(loop, 'imported:cue-1', { kind: 'loop-length-ms', requestedMs: -500, timingMode: 'exact' }, loopBeats).error)
      .toContain('after loop start');
  });

  it('resizes loops in snapped or exact mode and keeps beat-loop metadata truthful', () => {
    const loop = normalizeImportedCues('track-a', [importedCue({ point_type: 'loop', start_ms: 1000, end_ms: 3000 })]);
    const snapped = editWorkingCue(loop, 'imported:cue-1', { kind: 'end-ms', requestedMs: 4200, timingMode: 'snap' }, loopBeats);
    expect(snapped.error).toBeNull();
    expect(snapped.cues[0]).toMatchObject({ endMs: 4000, beatLoopNumerator: 6, beatLoopDenominator: 1 });

    const exact = editWorkingCue(snapped.cues, 'imported:cue-1', { kind: 'loop-length-ms', requestedMs: 3333, timingMode: 'exact' }, loopBeats);
    expect(exact.error).toBeNull();
    expect(exact.cues[0]).toMatchObject({ endMs: 4333, beatLoopNumerator: null, beatLoopDenominator: null });
  });

  it('edits comment, color, and active-loop state through canonical editor actions', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ point_type: 'loop', start_ms: 1000, end_ms: 3000 })]);
    const comment = editWorkingCue(baseline, 'imported:cue-1', { kind: 'comment', comment: 'Drop loop' });
    const color = editWorkingCue(comment.cues, 'imported:cue-1', {
      kind: 'color', colorTableIndex: 5, colorHex: '#00FFFF', colorName: 'Aqua',
    });
    const active = editWorkingCue(color.cues, 'imported:cue-1', { kind: 'active-loop', isActiveLoop: true });

    expect(active.error).toBeNull();
    expect(active.cues[0]).toMatchObject({
      comment: 'Drop loop',
      colorTableIndex: 6,
      colorHex: '#00FFFF',
      colorName: 'Aqua',
      isActiveLoop: true,
    });
    expect(workingCueSetsEqual(baseline, active.cues)).toBe(false);

    const point = normalizeImportedCues('track-a', [importedCue()]);
    expect(editWorkingCue(point, 'imported:cue-1', { kind: 'active-loop', isActiveLoop: true }).error)
      .toContain('only for loop');
  });

  it('keeps beat snapping as default while exact mode preserves deliberate off-grid milliseconds', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ start_ms: 500 })]);
    const snapped = moveWorkingCue(baseline, 'imported:cue-1', 1111, variableTempoBeats);
    expect(snapped.cues[0].startMs).toBe(980);

    const exact = moveWorkingCue(baseline, 'imported:cue-1', 1111, variableTempoBeats, 'exact');
    expect(exact.error).toBeNull();
    expect(exact.cues[0].startMs).toBe(1111);

    const loop = normalizeImportedCues('track-a', [importedCue({
      point_type: 'loop', start_ms: 500, end_ms: 1430, beat_loop_numerator: 2, beat_loop_denominator: 1,
    })]);
    const exactLoop = moveWorkingCue(loop, 'imported:cue-1', 1111, variableTempoBeats, 'exact');
    expect(exactLoop.cues[0]).toMatchObject({
      startMs: 1111,
      endMs: 2041,
      beatLoopNumerator: null,
      beatLoopDenominator: null,
    });

    const exactAdded = addWorkingCue([], {
      editorId: 'manual:exact',
      trackId: 'track-a',
      family: 'memory',
      requestedMs: 1234.4,
      beats: [],
      timingMode: 'exact',
    });
    expect(exactAdded.error).toBeNull();
    expect(exactAdded.cues[0].startMs).toBe(1234);
  });

  it('allows deliberate repeated snap/exact timing changes without sticky mode state', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ start_ms: 500 })]);
    const exact = moveWorkingCue(baseline, 'imported:cue-1', 1111, loopBeats, 'exact');
    const snapped = moveWorkingCue(exact.cues, 'imported:cue-1', 1111, loopBeats, 'snap');
    const exactAgain = moveWorkingCue(snapped.cues, 'imported:cue-1', 1234, loopBeats, 'exact');
    const snappedAgain = moveWorkingCue(exactAgain.cues, 'imported:cue-1', 1234, loopBeats, 'snap');

    expect(exact.cues[0].startMs).toBe(1111);
    expect(snapped.cues[0].startMs).toBe(1000);
    expect(exactAgain.cues[0].startMs).toBe(1234);
    expect(snappedAgain.cues[0].startMs).toBe(1000);
  });

  it('preserves unusual Rekordbox color table indices instead of guessing a palette meaning', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({ color_table_index: 42, color_hex: null, color_name: null })]);
    const changed = editWorkingCue(baseline, 'imported:cue-1', {
      kind: 'color', colorTableIndex: 77, colorHex: null, colorName: null,
    });
    expect(changed.error).toBeNull();
    expect(changed.cues[0]).toMatchObject({ colorTableIndex: 77, colorHex: null, colorName: null });
  });

  it('marks every Stage 5 editable field as dirty when its canonical value changes', () => {
    const baseline = normalizeImportedCues('track-a', [importedCue({
      point_type: 'loop',
      start_ms: 1000,
      end_ms: 3000,
      is_active_loop: false,
      beat_loop_numerator: 4,
      beat_loop_denominator: 1,
    })]);
    const editableChanges: Array<Partial<(typeof baseline)[number]>> = [
      { family: 'memory', hotCueSlot: null },
      { hotCueSlot: 2 },
      { pointType: 'cue' },
      { startMs: 1111 },
      { endMs: 3333 },
      { colorTableIndex: 7 },
      { colorHex: '#0000FF' },
      { colorName: 'Blue' },
      { comment: 'Changed' },
      { isActiveLoop: true },
      { beatLoopNumerator: 6 },
      { beatLoopDenominator: 2 },
    ];

    for (const change of editableChanges) {
      expect(workingCueSetsEqual(baseline, [{ ...baseline[0], ...change }])).toBe(false);
    }
  });

  it('keeps track-scoped baselines isolated', () => {
    const trackA = normalizeImportedCues('track-a', [importedCue({ track_id: 'track-a' })]);
    const trackB = normalizeImportedCues('track-b', [importedCue({ id: 'cue-b', track_id: 'track-b' })]);
    const editedA = addWorkingCue(trackA, {
      editorId: 'manual:a',
      trackId: 'track-a',
      family: 'memory',
      requestedMs: 980,
      beats: variableTempoBeats,
    }).cues;

    expect(editedA.every((cue) => cue.trackId === 'track-a')).toBe(true);
    expect(trackB.every((cue) => cue.trackId === 'track-b')).toBe(true);
    expect(trackB.some((cue) => cue.editorId === 'manual:a')).toBe(false);
  });
});
