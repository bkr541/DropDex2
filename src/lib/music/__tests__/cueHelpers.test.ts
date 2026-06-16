import { describe, expect, it } from 'vitest';
import {
  beatLoopRatio,
  cueColorOrFallback,
  hotCueLabel,
  hotCuesOnly,
  isConfirmedByBothSources,
  loopsOnly,
  memoryCuesOnly,
} from '../cueHelpers';
import type { CueRow } from '../cueHelpers';

function makeCue(overrides: Partial<CueRow> = {}): CueRow {
  return {
    id: 'test-id',
    cue_family: 'memory',
    hot_cue_slot: null,
    point_type: 'cue',
    start_ms: 0,
    end_ms: null,
    color_hex: null,
    color_name: null,
    comment: null,
    is_active_loop: null,
    beat_loop_numerator: null,
    beat_loop_denominator: null,
    source_db_present: true,
    source_anlz_present: true,
    ...overrides,
  };
}

describe('hotCueLabel', () => {
  it('returns A for slot 1', () => expect(hotCueLabel(1)).toBe('A'));
  it('returns H for slot 8', () => expect(hotCueLabel(8)).toBe('H'));
  it('returns null for null slot', () => expect(hotCueLabel(null)).toBeNull());
  it('returns null for unknown slot 9', () => expect(hotCueLabel(9)).toBeNull());

  const expected: [number, string][] = [
    [1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'],
    [5, 'E'], [6, 'F'], [7, 'G'], [8, 'H'],
  ];
  for (const [slot, label] of expected) {
    it(`maps slot ${slot} → "${label}"`, () => expect(hotCueLabel(slot)).toBe(label));
  }
});

describe('hotCuesOnly', () => {
  it('returns only hot cues', () => {
    const cues = [
      makeCue({ id: '1', cue_family: 'hot', hot_cue_slot: 2 }),
      makeCue({ id: '2', cue_family: 'memory' }),
      makeCue({ id: '3', cue_family: 'hot', hot_cue_slot: 1 }),
    ];
    const result = hotCuesOnly(cues);
    expect(result).toHaveLength(2);
    expect(result.every(c => c.cue_family === 'hot')).toBe(true);
  });

  it('sorts by slot number ascending', () => {
    const cues = [
      makeCue({ cue_family: 'hot', hot_cue_slot: 3 }),
      makeCue({ cue_family: 'hot', hot_cue_slot: 1 }),
      makeCue({ cue_family: 'hot', hot_cue_slot: 2 }),
    ];
    const result = hotCuesOnly(cues);
    expect(result.map(c => c.hot_cue_slot)).toEqual([1, 2, 3]);
  });

  it('places null-slot cues last', () => {
    const cues = [
      makeCue({ cue_family: 'hot', hot_cue_slot: null }),
      makeCue({ cue_family: 'hot', hot_cue_slot: 1 }),
    ];
    const result = hotCuesOnly(cues);
    expect(result[0].hot_cue_slot).toBe(1);
    expect(result[1].hot_cue_slot).toBeNull();
  });

  it('returns empty array when no hot cues', () => {
    expect(hotCuesOnly([makeCue()])).toHaveLength(0);
  });
});

describe('memoryCuesOnly', () => {
  it('returns only memory cues', () => {
    const cues = [
      makeCue({ cue_family: 'memory', start_ms: 100 }),
      makeCue({ cue_family: 'hot', hot_cue_slot: 1 }),
    ];
    const result = memoryCuesOnly(cues);
    expect(result).toHaveLength(1);
    expect(result[0].cue_family).toBe('memory');
  });

  it('sorts by start_ms ascending', () => {
    const cues = [
      makeCue({ cue_family: 'memory', start_ms: 500 }),
      makeCue({ cue_family: 'memory', start_ms: 100 }),
      makeCue({ cue_family: 'memory', start_ms: 250 }),
    ];
    const result = memoryCuesOnly(cues);
    expect(result.map(c => c.start_ms)).toEqual([100, 250, 500]);
  });

  it('places null-start_ms cues last', () => {
    const cues = [
      makeCue({ cue_family: 'memory', start_ms: null }),
      makeCue({ cue_family: 'memory', start_ms: 100 }),
    ];
    const result = memoryCuesOnly(cues);
    expect(result[0].start_ms).toBe(100);
    expect(result[1].start_ms).toBeNull();
  });
});

describe('loopsOnly', () => {
  it('returns only loops', () => {
    const cues = [
      makeCue({ point_type: 'loop', start_ms: 200 }),
      makeCue({ point_type: 'cue', start_ms: 100 }),
    ];
    const result = loopsOnly(cues);
    expect(result).toHaveLength(1);
    expect(result[0].point_type).toBe('loop');
  });

  it('sorts by start_ms ascending', () => {
    const cues = [
      makeCue({ point_type: 'loop', start_ms: 300 }),
      makeCue({ point_type: 'loop', start_ms: 100 }),
    ];
    const result = loopsOnly(cues);
    expect(result[0].start_ms).toBe(100);
  });
});

describe('cueColorOrFallback', () => {
  it('returns color_hex when present', () => {
    const cue = makeCue({ color_hex: '#FF0000' });
    expect(cueColorOrFallback(cue)).toBe('#FF0000');
  });

  it('returns fallback when color_hex is null', () => {
    const cue = makeCue({ color_hex: null });
    expect(cueColorOrFallback(cue, '#AABBCC')).toBe('#AABBCC');
  });

  it('returns null when no color and no fallback', () => {
    const cue = makeCue({ color_hex: null });
    expect(cueColorOrFallback(cue)).toBeNull();
  });
});

describe('beatLoopRatio', () => {
  it('returns null when numerator is null', () => {
    expect(beatLoopRatio(makeCue({ beat_loop_numerator: null, beat_loop_denominator: 4 }))).toBeNull();
  });

  it('returns null when denominator is null', () => {
    expect(beatLoopRatio(makeCue({ beat_loop_numerator: 1, beat_loop_denominator: null }))).toBeNull();
  });

  it('returns integer string when denominator is 1', () => {
    expect(beatLoopRatio(makeCue({ beat_loop_numerator: 4, beat_loop_denominator: 1 }))).toBe('4');
  });

  it('returns fraction string', () => {
    expect(beatLoopRatio(makeCue({ beat_loop_numerator: 1, beat_loop_denominator: 2 }))).toBe('1/2');
  });
});

describe('isConfirmedByBothSources', () => {
  it('returns true when both flags are true', () => {
    expect(isConfirmedByBothSources(makeCue({ source_db_present: true, source_anlz_present: true }))).toBe(true);
  });

  it('returns false when only db present', () => {
    expect(isConfirmedByBothSources(makeCue({ source_db_present: true, source_anlz_present: false }))).toBe(false);
  });

  it('returns false when only anlz present', () => {
    expect(isConfirmedByBothSources(makeCue({ source_db_present: false, source_anlz_present: true }))).toBe(false);
  });
});
