import { describe, expect, it } from 'vitest';
import type { BeatEntry, BeatGridRow, PhraseRow } from '../queries/analysisData';
import { beatAt, buildAudioIntelligence, intelligenceAt } from './audioIntelligence';

const beats: BeatEntry[] = Array.from({ length: 16 }, (_, i) => ({ seq: i + 1, srcIdx: i, beatInBar: (i % 4) + 1, bar: Math.floor(i / 4) + 1, ms: 1000 + i * 500, bpm: 120, isDownbeat: i % 4 === 0 }));
const grid = { id: 'g', import_id: 'i', track_id: 't', source_tag: 'PQTZ', beats, beat_count: 16, downbeat_count: 4, bar_count: 4, first_beat_ms: 1000, first_downbeat_ms: 1000, minimum_bpm: 120, maximum_bpm: 120, is_variable_tempo: false, parser_version: '1' } as BeatGridRow;
const phrase = (id: string, kind: string, start: number, end: number, index: number) => ({ id, import_id: 'i', track_id: 't', phrase_index: index, source_mood: 'high', source_kind: kind, source_bank: null, normalized_label: kind, start_beat: null, end_beat: null, start_ms: start, end_ms: end, fill_start_beat: null, fill_start_ms: null, source_flags: {}, source_payload: {}, parser_version: '1' }) as PhraseRow;

describe('audio intelligence from Rekordbox data', () => {
  const model = buildAudioIntelligence({ beatGrid: grid, phrases: [phrase('a', 'intro', 1000, 3000, 0), phrase('b', 'down', 3000, 9000, 1)], durationMs: 9000, trackBpm: 118 });

  it('reads tempo and bar length from the beat grid', () => {
    expect(model.bpm).toBe(120);
    expect(model.beatsPerBar).toBe(4);
    expect(model.barCount).toBe(4);
  });

  it('finds the beat playing at a time, and nothing before the first beat', () => {
    expect(beatAt(beats, 500)).toBeNull();
    expect(beatAt(beats, 1000)?.seq).toBe(1);
    expect(beatAt(beats, 1749)?.seq).toBe(2);
    expect(beatAt(beats, 99999)?.seq).toBe(16);
  });

  it('says which beat, bar, phrase and section the playhead is in, and how far through each', () => {
    const at = intelligenceAt(model, 3250);
    expect(at.beat?.bar).toBe(2);
    expect(at.beat?.beatInBar).toBe(1);
    expect(at.beatPhase).toBeCloseTo(0.5);
    expect(at.phrase?.label).toBe('Drop');
    expect(at.section?.label).toBe('Drop');
    expect(at.sectionProgress).toBeCloseTo(250 / 6000);
  });

  it('counts the bars in each phrase', () => {
    expect(model.phrases[0].bars).toBe(1);
    expect(model.phrases[1].startBar).toBe(2);
  });
});
