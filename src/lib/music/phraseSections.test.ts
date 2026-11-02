import { describe, expect, it } from 'vitest';
import type { BeatGridRow, PhraseRow } from '../queries/analysisData';
import { buildTimelineSections, sectionDisplayLabel, sectionTone } from './phraseSections';

function phrase(overrides: Partial<PhraseRow>): PhraseRow {
  return {
    id: 'p',
    phrase_index: 0,
    source_mood: null,
    normalized_label: null,
    start_beat: null,
    end_beat: null,
    start_ms: null,
    end_ms: null,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: null,
    ...overrides,
  } as PhraseRow;
}

describe('sectionDisplayLabel', () => {
  it('uses the app-wide names: Up is Build and Down is Drop', () => {
    expect(sectionDisplayLabel('up', 0)).toBe('Build');
    expect(sectionDisplayLabel('down', 0)).toBe('Drop');
    expect(sectionDisplayLabel('verse2', 0)).toBe('Verse 2');
    expect(sectionDisplayLabel('INTRO', 0)).toBe('Intro');
    expect(sectionDisplayLabel('chorus', 0)).toBe('Chorus');
    expect(sectionDisplayLabel('bridge', 0)).toBe('Bridge');
    expect(sectionDisplayLabel('outro', 0)).toBe('Outro');
  });

  it('title-cases unknown names and numbers sections with no name', () => {
    expect(sectionDisplayLabel('half_time', 0)).toBe('Half Time');
    expect(sectionDisplayLabel(null, 2)).toBe('Section 3');
  });
});

describe('sectionTone', () => {
  it('gives each kind of section its own color', () => {
    const tones = ['Intro', 'Verse', 'Build', 'Drop', 'Chorus', 'Bridge', 'Outro'].map((label) => sectionTone(label).waveformColor);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('falls back to a neutral color', () => {
    expect(sectionTone('Something else').waveformColor).toBe('#8d9aaa');
  });
});

describe('buildTimelineSections', () => {
  it('returns nothing without a usable duration', () => {
    expect(buildTimelineSections([phrase({ start_ms: 0, end_ms: 1000 })], null, null)).toEqual([]);
    expect(buildTimelineSections([phrase({ start_ms: 0, end_ms: 1000 })], null, 0)).toEqual([]);
  });

  it('orders sections by time, names them, and clamps them to the track length', () => {
    const sections = buildTimelineSections([
      phrase({ id: 'b', normalized_label: 'down', start_ms: 30_000, end_ms: 200_000 }),
      phrase({ id: 'a', normalized_label: 'up', start_ms: 0, end_ms: 30_000 }),
    ], null, 100_000);
    expect(sections.map((s) => [s.id, s.label, s.startMs, s.endMs])).toEqual([
      ['a', 'Build', 0, 30_000],
      ['b', 'Drop', 30_000, 100_000],
    ]);
  });

  it('ends a section where the next one starts when it has no end of its own', () => {
    const sections = buildTimelineSections([
      phrase({ id: 'a', normalized_label: 'intro', start_ms: 0 }),
      phrase({ id: 'b', normalized_label: 'verse', start_ms: 16_000 }),
    ], null, 60_000);
    expect(sections.map((s) => [s.startMs, s.endMs])).toEqual([[0, 16_000], [16_000, 60_000]]);
  });

  it('places sections from the beat grid when they have no timestamps', () => {
    const beatGrid = { beats: [{ seq: 1, ms: 500, bpm: 120 }, { seq: 33, ms: 16_500, bpm: 120 }] } as unknown as BeatGridRow;
    const sections = buildTimelineSections([
      phrase({ id: 'a', normalized_label: 'intro', start_beat: 1, end_beat: 33 }),
    ], beatGrid, 60_000);
    expect(sections).toHaveLength(1);
    expect(sections[0].startMs).toBe(500);
    expect(sections[0].endMs).toBe(16_500);
  });

  it('skips sections that cannot be placed or have no length', () => {
    const sections = buildTimelineSections([
      phrase({ id: 'unplaced', normalized_label: 'intro' }),
      phrase({ id: 'empty', normalized_label: 'verse', start_ms: 5_000, end_ms: 5_000 }),
    ], null, 60_000);
    expect(sections).toEqual([]);
  });
});
