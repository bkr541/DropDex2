import type { BeatEntry, CueRow, PhraseRow } from '../../lib/queries/analysisData';

export const trackScope = { track_id: 'track-1', import_id: 'import-1' };

/** PQTZ-shaped one-based records, with a tempo change after eight bars. */
export function grid(bars = 32): BeatEntry[] {
  return Array.from({ length: bars * 4 + 1 }, (_, i) => ({
    seq: i + 1, srcIdx: i, beatInBar: i % 4 + 1, bar: Math.floor(i / 4) + 1,
    ms: i <= 32 ? i * 500 : 16_000 + (i - 32) * 400,
    bpm: i < 32 ? 120 : 150, isDownbeat: i % 4 === 0,
  }));
}

export function phrase(index: number, type: string, startBeat: number, endBeat: number): PhraseRow {
  return {
    ...trackScope, id: `phrase-${index}`, phrase_index: index,
    normalized_label: type, source_kind: null, source_mood: null, source_bank: null,
    start_beat: startBeat, end_beat: endBeat, start_ms: null, end_ms: null, fill_start_ms: null, fill_start_beat: null,
    source_flags: {}, source_payload: {}, parser_version: null,
  };
}

export function cue(id: string, family: CueRow['cue_family'], ms: number): CueRow {
  return {
    ...trackScope, id, rekordbox_cue_id: id, dedupe_key: id,
    cue_family: family, cue_family_authority: 'anlz', hot_cue_slot: family === 'hot' ? 1 : null,
    point_type: 'cue', source_kind: null, start_ms: ms, end_ms: null, color_table_index: null,
    color_hex: null, color_name: null, comment: null, is_active_loop: null,
    beat_loop_numerator: null, beat_loop_denominator: null,
    source_db_present: false, source_anlz_present: true, source_conflict: false, source_payload: null,
  };
}
