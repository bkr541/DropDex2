import { describe, expect, it } from 'vitest';
import type { BeatEntry } from './beatGridHelpers';
import {
  addWorkingCue,
  deleteWorkingCue,
  isCurrentTrackResponse,
  moveWorkingCue,
  nextAvailableHotCueSlot,
  normalizeImportedCues,
  workingCueSetsEqual,
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
