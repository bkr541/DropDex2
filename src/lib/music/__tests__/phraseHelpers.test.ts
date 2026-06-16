import { describe, expect, it } from 'vitest';
import {
  groupByLabel,
  orderedBoundaries,
  phraseDurationMs,
  phraseAtMs,
  trackMood,
} from '../phraseHelpers';
import type { PhraseRow } from '../phraseHelpers';

function makePhrase(overrides: Partial<PhraseRow> = {}): PhraseRow {
  return {
    id: 'p1',
    phrase_index: 0,
    source_mood: '1',
    normalized_label: 'intro',
    start_beat: 1,
    end_beat: 33,
    start_ms: 0,
    end_ms: 16000,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: '2.0.0',
    ...overrides,
  };
}

describe('phraseAtMs', () => {
  const phrases: PhraseRow[] = [
    makePhrase({ phrase_index: 0, start_ms: 0, end_ms: 16000, normalized_label: 'intro' }),
    makePhrase({ phrase_index: 1, start_ms: 16000, end_ms: 48000, normalized_label: 'verse' }),
    makePhrase({ phrase_index: 2, start_ms: 48000, end_ms: null, normalized_label: 'outro' }),
  ];

  it('returns null when before first phrase', () => {
    const p: PhraseRow[] = [makePhrase({ start_ms: 5000 })];
    expect(phraseAtMs(p, 1000)).toBeNull();
  });

  it('returns phrase containing the ms (inclusive start)', () => {
    expect(phraseAtMs(phrases, 0)?.normalized_label).toBe('intro');
    expect(phraseAtMs(phrases, 16000)?.normalized_label).toBe('verse');
  });

  it('excludes end_ms (exclusive end)', () => {
    // At exactly 16000ms: should be in verse, not intro
    expect(phraseAtMs(phrases, 15999)?.normalized_label).toBe('intro');
    expect(phraseAtMs(phrases, 16000)?.normalized_label).toBe('verse');
  });

  it('matches phrase with null end_ms for any ms >= start_ms', () => {
    expect(phraseAtMs(phrases, 999999)?.normalized_label).toBe('outro');
  });

  it('returns null for empty phrases', () => {
    expect(phraseAtMs([], 1000)).toBeNull();
  });

  it('skips phrases with null start_ms', () => {
    const p = [makePhrase({ start_ms: null }), makePhrase({ phrase_index: 1, start_ms: 0, end_ms: null })];
    expect(phraseAtMs(p, 5000)?.phrase_index).toBe(1);
  });
});

describe('orderedBoundaries', () => {
  it('returns sorted unique ms values', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ start_ms: 16000, end_ms: 48000 }),
      makePhrase({ start_ms: 0, end_ms: 16000 }),
    ];
    expect(orderedBoundaries(phrases)).toEqual([0, 16000, 48000]);
  });

  it('deduplicates shared boundaries', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ start_ms: 0, end_ms: 16000 }),
      makePhrase({ start_ms: 16000, end_ms: 32000 }),
    ];
    // 16000 appears once even though it's both end and start
    expect(orderedBoundaries(phrases)).toEqual([0, 16000, 32000]);
  });

  it('omits null ms values', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ start_ms: null, end_ms: 5000 }),
      makePhrase({ start_ms: 5000, end_ms: null }),
    ];
    expect(orderedBoundaries(phrases)).toEqual([5000]);
  });

  it('returns empty for empty phrases', () => {
    expect(orderedBoundaries([])).toHaveLength(0);
  });
});

describe('groupByLabel', () => {
  it('groups by normalized_label', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ phrase_index: 0, normalized_label: 'verse' }),
      makePhrase({ phrase_index: 1, normalized_label: 'chorus' }),
      makePhrase({ phrase_index: 2, normalized_label: 'verse' }),
    ];
    const result = groupByLabel(phrases);
    expect(Object.keys(result).sort()).toEqual(['chorus', 'verse']);
    expect(result['verse']).toHaveLength(2);
    expect(result['chorus']).toHaveLength(1);
  });

  it('groups null labels under "unknown"', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ normalized_label: null }),
      makePhrase({ phrase_index: 1, normalized_label: null }),
    ];
    const result = groupByLabel(phrases);
    expect(result['unknown']).toHaveLength(2);
  });

  it('preserves order within each group', () => {
    const phrases: PhraseRow[] = [
      makePhrase({ phrase_index: 0, normalized_label: 'verse' }),
      makePhrase({ phrase_index: 2, normalized_label: 'verse' }),
      makePhrase({ phrase_index: 1, normalized_label: 'chorus' }),
    ];
    const result = groupByLabel(phrases);
    expect(result['verse'][0].phrase_index).toBe(0);
    expect(result['verse'][1].phrase_index).toBe(2);
  });

  it('returns empty object for empty array', () => {
    expect(groupByLabel([])).toEqual({});
  });
});

describe('trackMood', () => {
  it('returns source_mood of first phrase', () => {
    const phrases = [
      makePhrase({ source_mood: '2' }),
      makePhrase({ source_mood: '2', phrase_index: 1 }),
    ];
    expect(trackMood(phrases)).toBe('2');
  });

  it('returns null for empty array', () => {
    expect(trackMood([])).toBeNull();
  });

  it('returns null when source_mood is null', () => {
    expect(trackMood([makePhrase({ source_mood: null })])).toBeNull();
  });
});

describe('phraseDurationMs', () => {
  it('computes duration', () => {
    const p = makePhrase({ start_ms: 1000, end_ms: 5000 });
    expect(phraseDurationMs(p)).toBe(4000);
  });

  it('returns null when start_ms is null', () => {
    expect(phraseDurationMs(makePhrase({ start_ms: null }))).toBeNull();
  });

  it('returns null when end_ms is null', () => {
    expect(phraseDurationMs(makePhrase({ end_ms: null }))).toBeNull();
  });
});
