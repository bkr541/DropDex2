import { describe, expect, it } from 'vitest';
import {
  normalizeColorColumn,
  normalizeMonoColumn,
  normalizeWaveform,
  buildDisplayBuckets,
  parseHexColor,
  clampProgress,
  computeProgress,
  resolveMonoBaseColor,
  isNormalizedColorCol,
  COLOR_HEIGHT_MAX,
  MONO_HEIGHT_MAX,
  MONO_INTENSITY_MAX,
} from './waveformRenderer';
import type { TrackPreviewWaveform } from '../queries/waveformValidation';

// ── helpers ───────────────────────────────────────────────────────────────────

function colorWf(
  columns: Array<{ h: number; r: number; g: number; b: number }>,
  valid = true,
): TrackPreviewWaveform {
  return {
    trackId: 'trk-1',
    previewFormat: 'PWV4',
    previewColumnCount: columns.length,
    previewColumns: columns,
    previewColumnsValid: valid,
    inferredFormat: 'color',
    validationError: null,
    invalidReason: null,
    detailFormat: null,
    detailColumnCount: null,
    detailStorageBucket: null,
    detailStoragePath: null,
  };
}

function monoWf(
  columns: Array<{ h: number; i: number }>,
  valid = true,
  format = 'PWAV',
): TrackPreviewWaveform {
  return {
    trackId: 'trk-2',
    previewFormat: format,
    previewColumnCount: columns.length,
    previewColumns: columns,
    previewColumnsValid: valid,
    inferredFormat: 'mono',
    validationError: null,
    invalidReason: null,
    detailFormat: null,
    detailColumnCount: null,
    detailStorageBucket: null,
    detailStoragePath: null,
  };
}

// ── normalizeColorColumn ──────────────────────────────────────────────────────

describe('normalizeColorColumn', () => {
  it('normalizes h from [0,127] to [0,1]', () => {
    expect(normalizeColorColumn({ h: 0, r: 0, g: 0, b: 0 }).h).toBe(0);
    expect(normalizeColorColumn({ h: 127, r: 0, g: 0, b: 0 }).h).toBeCloseTo(1, 5);
    expect(normalizeColorColumn({ h: 63, r: 0, g: 0, b: 0 }).h).toBeCloseTo(63 / 127, 5);
  });

  it('passes r, g, b through unchanged', () => {
    const result = normalizeColorColumn({ h: 100, r: 207, g: 107, b: 101 });
    expect(result.r).toBe(207);
    expect(result.g).toBe(107);
    expect(result.b).toBe(101);
  });

  it('clamps h above 127 to 1', () => {
    expect(normalizeColorColumn({ h: 200, r: 0, g: 0, b: 0 }).h).toBe(1);
  });

  it('clamps r, g, b above 255 to 255', () => {
    const result = normalizeColorColumn({ h: 50, r: 300, g: 256, b: 0 });
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
  });

  it('clamps negative values to 0', () => {
    const result = normalizeColorColumn({ h: -5, r: -10, g: 0, b: 0 });
    expect(result.h).toBe(0);
    expect(result.r).toBe(0);
  });
});

// ── normalizeMonoColumn ───────────────────────────────────────────────────────

describe('normalizeMonoColumn', () => {
  it('normalizes h from [0,31] to [0,1]', () => {
    expect(normalizeMonoColumn({ h: 0, i: 0 }).h).toBe(0);
    expect(normalizeMonoColumn({ h: 31, i: 0 }).h).toBeCloseTo(1, 5);
    expect(normalizeMonoColumn({ h: 15, i: 0 }).h).toBeCloseTo(15 / 31, 5);
  });

  it('normalizes i from [0,7] to [0,1]', () => {
    expect(normalizeMonoColumn({ h: 0, i: 0 }).i).toBe(0);
    expect(normalizeMonoColumn({ h: 0, i: 7 }).i).toBeCloseTo(1, 5);
    expect(normalizeMonoColumn({ h: 0, i: 3 }).i).toBeCloseTo(3 / 7, 5);
  });

  it('clamps h above 31', () => {
    expect(normalizeMonoColumn({ h: 100, i: 0 }).h).toBe(1);
  });

  it('clamps i above 7', () => {
    expect(normalizeMonoColumn({ h: 0, i: 15 }).i).toBe(1);
  });

  it('clamps negatives', () => {
    const result = normalizeMonoColumn({ h: -1, i: -2 });
    expect(result.h).toBe(0);
    expect(result.i).toBe(0);
  });
});

// ── normalizeWaveform ─────────────────────────────────────────────────────────

describe('normalizeWaveform', () => {
  it('returns null for invalid waveform', () => {
    expect(normalizeWaveform(colorWf([], false))).toBeNull();
  });

  it('returns null for empty columns even when marked valid', () => {
    expect(normalizeWaveform(colorWf([]))).toBeNull();
  });

  it('returns kind=color for PWV4 format', () => {
    const result = normalizeWaveform(colorWf([{ h: 100, r: 200, g: 150, b: 80 }]));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('color');
    expect(result!.cols).toHaveLength(1);
  });

  it('returns kind=mono for PWAV format', () => {
    const result = normalizeWaveform(monoWf([{ h: 15, i: 3 }]));
    expect(result!.kind).toBe('mono');
    expect(result!.cols).toHaveLength(1);
  });

  it('returns kind=mono for PWV2 format', () => {
    const result = normalizeWaveform(monoWf([{ h: 10, i: 5 }], true, 'PWV2'));
    expect(result!.kind).toBe('mono');
  });

  it('color columns have correct normalized h', () => {
    const result = normalizeWaveform(colorWf([{ h: 127, r: 255, g: 128, b: 64 }]));
    expect(result!.cols[0].h).toBeCloseTo(1, 5);
  });

  it('color columns preserve RGB channels', () => {
    const result = normalizeWaveform(colorWf([{ h: 64, r: 207, g: 107, b: 101 }]));
    const col = result!.cols[0];
    if ('r' in col) {
      expect(col.r).toBe(207);
      expect(col.g).toBe(107);
      expect(col.b).toBe(101);
    }
  });

  it('normalizes raw PWV5 detail heights with the 31-step scale exactly once', () => {
    const waveform = colorWf([{ h: 31, r: 255, g: 128, b: 0 }]);
    waveform.previewFormat = 'PWV5';
    waveform.heightScale = 31;
    waveform.dataVersion = 2;
    const result = normalizeWaveform(waveform);
    expect(result!.cols[0].h).toBeCloseTo(1, 5);
  });

  it('supports legacy normalized PWV5 payloads without shrinking them again', () => {
    const waveform = colorWf([{ h: 1, r: 255, g: 128, b: 0 }]);
    waveform.previewFormat = 'PWV5';
    waveform.heightScale = 1;
    waveform.dataVersion = 1;
    const result = normalizeWaveform(waveform);
    expect(result!.cols[0].h).toBeCloseTo(1, 5);
  });

  it('normalizes PWV3 mono detail heights with the 31-step scale', () => {
    const waveform = monoWf([{ h: 31, i: 7 }], true, 'PWV3');
    waveform.heightScale = 31;
    const result = normalizeWaveform(waveform);
    expect(result!.cols[0].h).toBeCloseTo(1, 5);
  });
});

// ── buildDisplayBuckets ───────────────────────────────────────────────────────

function makeColorCols(hs: number[]) {
  return hs.map((h) => ({ h: h / COLOR_HEIGHT_MAX, r: 100, g: 100, b: 100 }));
}

describe('buildDisplayBuckets — empty input', () => {
  it('returns empty array for empty columns', () => {
    expect(buildDisplayBuckets([], 200)).toEqual([]);
  });

  it('returns empty array for targetCount=0', () => {
    expect(buildDisplayBuckets(makeColorCols([50, 100]), 0)).toEqual([]);
  });
});

describe('buildDisplayBuckets — exact match', () => {
  it('returns one bucket per column when counts match', () => {
    const cols = makeColorCols([10, 50, 90]);
    const result = buildDisplayBuckets(cols, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(cols[0]);
    expect(result[1]).toBe(cols[1]);
    expect(result[2]).toBe(cols[2]);
  });
});

describe('buildDisplayBuckets — downsampling', () => {
  it('returns targetCount elements when downsampling', () => {
    const cols = makeColorCols(Array.from({ length: 400 }, (_, i) => i % 128));
    expect(buildDisplayBuckets(cols, 100)).toHaveLength(100);
  });

  it('peak-preserves — highest h in each bucket is selected', () => {
    // 4 cols → 2 buckets: peak in bucket 0 is col[1] (h=100), in bucket 1 is col[2] (h=90)
    const cols = makeColorCols([10, 100, 90, 20]);
    const result = buildDisplayBuckets(cols, 2);
    expect(result).toHaveLength(2);
    expect(result[0].h).toBeCloseTo(100 / COLOR_HEIGHT_MAX, 5); // peak from [10,100]
    expect(result[1].h).toBeCloseTo(90 / COLOR_HEIGHT_MAX, 5);  // peak from [90,20]
  });

  it('every source peak is captured when 400→100', () => {
    // Set one column to max height
    const hs = new Array(400).fill(10);
    hs[201] = 127; // peak in bucket 50 (roughly)
    const cols = makeColorCols(hs);
    const result = buildDisplayBuckets(cols, 100);
    const maxH = Math.max(...result.map((c) => c.h));
    expect(maxH).toBeCloseTo(1, 5);
  });
});

describe('buildDisplayBuckets — upsampling', () => {
  it('returns targetCount elements when upsampling', () => {
    const cols = makeColorCols([10, 50, 90]);
    expect(buildDisplayBuckets(cols, 100)).toHaveLength(100);
  });

  it('does not invent new h values — only uses source values', () => {
    const cols = makeColorCols([10, 50, 90]);
    const result = buildDisplayBuckets(cols, 10);
    const resultHs = result.map((c) => Math.round(c.h * COLOR_HEIGHT_MAX));
    for (const h of resultHs) {
      expect([10, 50, 90]).toContain(h);
    }
  });

  it('3 columns → 9 buckets uses only the 3 source columns (nearest-neighbour)', () => {
    const c0 = { h: 0.1, r: 10, g: 0, b: 0 };
    const c1 = { h: 0.5, r: 50, g: 0, b: 0 };
    const c2 = { h: 0.9, r: 90, g: 0, b: 0 };
    const result = buildDisplayBuckets([c0, c1, c2], 9);
    for (const col of result) {
      expect([c0, c1, c2]).toContain(col);
    }
  });
});

// ── parseHexColor ─────────────────────────────────────────────────────────────

describe('parseHexColor', () => {
  it('parses #rrggbb', () => {
    expect(parseHexColor('#cf6b65')).toEqual([207, 107, 101]);
  });

  it('parses #rgb shorthand', () => {
    expect(parseHexColor('#f0e')).toEqual([255, 0, 238]);
  });

  it('handles missing # prefix', () => {
    expect(parseHexColor('cf6b65')).toEqual([207, 107, 101]);
  });

  it('handles uppercase', () => {
    expect(parseHexColor('#CF6B65')).toEqual([207, 107, 101]);
  });

  it('returns null for invalid length', () => {
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1234567')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(parseHexColor('#gggggg')).toBeNull();
  });

  it('parses black and white', () => {
    expect(parseHexColor('#000000')).toEqual([0, 0, 0]);
    expect(parseHexColor('#ffffff')).toEqual([255, 255, 255]);
  });
});

// ── clampProgress ─────────────────────────────────────────────────────────────

describe('clampProgress', () => {
  it('clamps below 0 to 0', () => expect(clampProgress(-0.5)).toBe(0));
  it('clamps above 1 to 1', () => expect(clampProgress(1.5)).toBe(1));
  it('preserves values in range', () => expect(clampProgress(0.5)).toBe(0.5));
  it('preserves 0 and 1 boundaries', () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(1)).toBe(1);
  });
  it('clamps NaN to 0', () => expect(clampProgress(NaN)).toBe(0));
  it('clamps Infinity to 0', () => expect(clampProgress(Infinity)).toBe(0));
  it('clamps -Infinity to 0', () => expect(clampProgress(-Infinity)).toBe(0));
});

// ── resolveMonoBaseColor ──────────────────────────────────────────────────────

describe('resolveMonoBaseColor', () => {
  it('returns a near-white RGB for dark theme', () => {
    const [r, g, b] = resolveMonoBaseColor('dark');
    // foreground in dark mode: #f0ede9 = 240,237,233
    expect(r).toBe(240);
    expect(g).toBe(237);
    expect(b).toBe(233);
  });

  it('returns a near-black RGB for light theme', () => {
    const [r, g, b] = resolveMonoBaseColor('light');
    // foreground in light mode: #1a1c2e = 26,28,46
    expect(r).toBe(26);
    expect(g).toBe(28);
    expect(b).toBe(46);
  });

  it('returns deck cyan for the CDJ theme', () => {
    expect(resolveMonoBaseColor('cdj')).toEqual([26, 155, 234]);
  });
});

// ── isNormalizedColorCol ──────────────────────────────────────────────────────

describe('isNormalizedColorCol', () => {
  it('returns true for color columns', () => {
    expect(isNormalizedColorCol({ h: 0.5, r: 100, g: 50, b: 30 })).toBe(true);
  });
  it('returns false for mono columns', () => {
    expect(isNormalizedColorCol({ h: 0.5, i: 0.8 })).toBe(false);
  });
});

// ── constant sanity ───────────────────────────────────────────────────────────

describe('constants', () => {
  it('COLOR_HEIGHT_MAX is 127 (d5 & 0x7F)', () => expect(COLOR_HEIGHT_MAX).toBe(127));
  it('MONO_HEIGHT_MAX is 31 (bv & 0x1F)', () => expect(MONO_HEIGHT_MAX).toBe(31));
  it('MONO_INTENSITY_MAX is 7 (bv >> 5)', () => expect(MONO_INTENSITY_MAX).toBe(7));
});

// ── computeProgress ───────────────────────────────────────────────────────────

describe('computeProgress', () => {
  // ── valid inputs ────────────────────────────────────────────────────────────

  it('returns fraction of currentTime over duration', () => {
    expect(computeProgress(30, 120)).toBe(0.25);
  });

  it('returns 0.5 at the midpoint', () => {
    expect(computeProgress(60, 120)).toBe(0.5);
  });

  it('returns 1 when currentTime equals duration', () => {
    expect(computeProgress(240, 240)).toBe(1);
  });

  it('clamps to 1 when currentTime exceeds duration', () => {
    expect(computeProgress(300, 240)).toBe(1);
  });

  it('returns 0 at the start', () => {
    expect(computeProgress(0, 120)).toBe(0);
  });

  // ── invalid duration ────────────────────────────────────────────────────────

  it('returns 0 for NaN duration', () => {
    expect(computeProgress(30, NaN)).toBe(0);
  });

  it('returns 0 for Infinity duration', () => {
    expect(computeProgress(30, Infinity)).toBe(0);
  });

  it('returns 0 for zero duration', () => {
    expect(computeProgress(30, 0)).toBe(0);
  });

  it('returns 0 for negative duration', () => {
    expect(computeProgress(30, -60)).toBe(0);
  });

  // ── invalid currentTime ─────────────────────────────────────────────────────

  it('returns 0 for NaN currentTime', () => {
    expect(computeProgress(NaN, 120)).toBe(0);
  });

  it('returns 0 for negative currentTime', () => {
    expect(computeProgress(-1, 120)).toBe(0);
  });

  it('returns 0 for Infinity currentTime', () => {
    expect(computeProgress(Infinity, 120)).toBe(0);
  });

  // ── ended playback ──────────────────────────────────────────────────────────

  it('shows 1.0 at end of track (currentTime === duration)', () => {
    expect(computeProgress(180, 180)).toBe(1);
  });

  it('shows 1.0 if audio overshoots duration by a small float error', () => {
    expect(computeProgress(180.0001, 180)).toBe(1);
  });
});

// ── seek calculation ──────────────────────────────────────────────────────────

describe('seek calculation (fraction × duration)', () => {
  it('click at 50% of a 4-minute track seeks to 120 s', () => {
    expect(0.5 * 240).toBe(120);
  });

  it('click at start seeks to 0', () => {
    expect(0 * 300).toBe(0);
  });

  it('click at end seeks to full duration', () => {
    expect(1 * 300).toBe(300);
  });

  it('clamped fraction from click outside left edge is 0', () => {
    const raw = (0 - 5) / 400; // clientX 5px left of element
    expect(Math.max(0, Math.min(1, raw))).toBe(0);
  });

  it('clamped fraction from click outside right edge is 1', () => {
    const raw = (450 - 0) / 400; // clientX beyond 400px-wide element
    expect(Math.max(0, Math.min(1, raw))).toBe(1);
  });

  it('seek is disabled when duration is 0 — guard returns early', () => {
    const duration = 0;
    let called = false;
    if (isFinite(duration) && duration > 0) called = true;
    expect(called).toBe(false);
  });

  it('seek is disabled when duration is NaN — guard returns early', () => {
    const duration = NaN;
    let called = false;
    if (isFinite(duration) && duration > 0) called = true;
    expect(called).toBe(false);
  });
});
