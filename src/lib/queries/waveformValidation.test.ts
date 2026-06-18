import { describe, it, expect } from 'vitest';
import {
  isColorColumn,
  isMonoColumn,
  validatePreviewColumns,
  buildTrackPreviewWaveform,
  chunkIds,
} from './waveformValidation';
import type { WaveformRow, PreviewColumnColor, PreviewColumnMono } from './waveformValidation';

// ── helpers ───────────────────────────────────────────────────────────────────

function colorCol(h = 100, r = 50, g = 60, b = 70): PreviewColumnColor {
  return { h, r, g, b };
}
function monoCol(h = 80, i = 40): PreviewColumnMono {
  return { h, i };
}
function makeRow(overrides: Partial<WaveformRow> = {}): WaveformRow {
  return {
    id: 'wf-1',
    import_id: 'imp-1',
    track_id: 'trk-1',
    preview_format: 'color',
    preview_column_count: 2,
    preview_columns: [colorCol(), colorCol()],
    detail_format: null,
    detail_column_count: null,
    detail_storage_bucket: null,
    detail_storage_path: null,
    parser_version: '1.0',
    ...overrides,
  };
}

// ── isColorColumn ─────────────────────────────────────────────────────────────

describe('isColorColumn', () => {
  it('accepts a valid color column', () => expect(isColorColumn(colorCol())).toBe(true));
  it('rejects a mono column', () => expect(isColorColumn(monoCol())).toBe(false));
  it('rejects null', () => expect(isColorColumn(null)).toBe(false));
  it('rejects a primitive', () => expect(isColorColumn(42)).toBe(false));
  it('rejects an object with missing fields', () => expect(isColorColumn({ h: 1, r: 2 })).toBe(false));
  it('rejects negative values', () => expect(isColorColumn({ h: -1, r: 0, g: 0, b: 0 })).toBe(false));
  it('rejects non-numeric fields', () => expect(isColorColumn({ h: '1', r: 0, g: 0, b: 0 })).toBe(false));
});

// ── isMonoColumn ──────────────────────────────────────────────────────────────

describe('isMonoColumn', () => {
  it('accepts a valid mono column', () => expect(isMonoColumn(monoCol())).toBe(true));
  it('rejects a color column', () => expect(isMonoColumn(colorCol())).toBe(false));
  it('rejects null', () => expect(isMonoColumn(null)).toBe(false));
  it('rejects an object missing i', () => expect(isMonoColumn({ h: 1 })).toBe(false));
  it('rejects negative h', () => expect(isMonoColumn({ h: -5, i: 10 })).toBe(false));
  it('rejects negative i', () => expect(isMonoColumn({ h: 10, i: -1 })).toBe(false));
});

// ── validatePreviewColumns ────────────────────────────────────────────────────

describe('validatePreviewColumns — shape checks', () => {
  it('rejects null input', () => {
    const r = validatePreviewColumns(null, null);
    expect(r.valid).toBe(false);
    expect(r.columns).toHaveLength(0);
  });

  it('rejects a non-array', () => {
    expect(validatePreviewColumns({ h: 1 }, null).valid).toBe(false);
    expect(validatePreviewColumns('string', null).valid).toBe(false);
    expect(validatePreviewColumns(42, null).valid).toBe(false);
  });

  it('accepts an empty array when expectedCount is null', () => {
    const r = validatePreviewColumns([], null);
    expect(r.valid).toBe(true);
    expect(r.inferredFormat).toBeNull();
  });

  it('rejects an empty array when expectedCount > 0', () => {
    const r = validatePreviewColumns([], 100);
    expect(r.valid).toBe(false);
  });

  it('accepts an empty array when expectedCount is 0', () => {
    expect(validatePreviewColumns([], 0).valid).toBe(true);
  });
});

describe('validatePreviewColumns — color waveform', () => {
  it('valid color columns → inferredFormat color', () => {
    const cols = [colorCol(), colorCol(), colorCol()];
    const r = validatePreviewColumns(cols, 3);
    expect(r.valid).toBe(true);
    expect(r.inferredFormat).toBe('color');
    expect(r.columns).toHaveLength(3);
  });

  it('column count mismatch marks invalid', () => {
    const cols = [colorCol(), colorCol()];
    const r = validatePreviewColumns(cols, 5);
    expect(r.valid).toBe(false);
    expect(r.inferredFormat).toBe('color');
  });

  it('returns original array reference unmodified', () => {
    const cols = [colorCol(255, 0, 128, 64)];
    const r = validatePreviewColumns(cols, 1);
    expect(r.columns[0]).toBe(cols[0]);
  });
});

describe('validatePreviewColumns — mono waveform', () => {
  it('valid mono columns → inferredFormat mono', () => {
    const cols = [monoCol(), monoCol()];
    const r = validatePreviewColumns(cols, 2);
    expect(r.valid).toBe(true);
    expect(r.inferredFormat).toBe('mono');
  });

  it('mono column count mismatch marks invalid', () => {
    const r = validatePreviewColumns([monoCol()], 99);
    expect(r.valid).toBe(false);
  });
});

describe('validatePreviewColumns — malformed JSON', () => {
  it('mixed color and mono in same array → invalid', () => {
    const r = validatePreviewColumns([colorCol(), monoCol()], 2);
    expect(r.valid).toBe(false);
    expect(r.inferredFormat).toBeNull();
  });

  it('array with null entries → invalid', () => {
    const r = validatePreviewColumns([null, null], 2);
    expect(r.valid).toBe(false);
  });

  it('array with string entries → invalid', () => {
    const r = validatePreviewColumns(['abc', 'def'], 2);
    expect(r.valid).toBe(false);
  });

  it('does not throw — returns valid:false instead', () => {
    expect(() => validatePreviewColumns({ broken: true }, 3)).not.toThrow();
    expect(() => validatePreviewColumns(undefined, null)).not.toThrow();
  });
});

// ── buildTrackPreviewWaveform ─────────────────────────────────────────────────

describe('buildTrackPreviewWaveform', () => {
  it('maps trackId', () => {
    expect(buildTrackPreviewWaveform(makeRow({ track_id: 'abc' })).trackId).toBe('abc');
  });

  it('preserves raw previewColumns', () => {
    const cols = [colorCol(10, 20, 30, 40)];
    const wf = buildTrackPreviewWaveform(makeRow({ preview_columns: cols, preview_column_count: 1 }));
    expect(wf.previewColumns).toBe(cols);
  });

  it('sets previewColumnsValid true for valid color columns', () => {
    const cols = [colorCol(), colorCol()];
    const wf = buildTrackPreviewWaveform(makeRow({ preview_columns: cols, preview_column_count: 2 }));
    expect(wf.previewColumnsValid).toBe(true);
    expect(wf.inferredFormat).toBe('color');
  });

  it('sets previewColumnsValid true for valid mono columns', () => {
    const cols = [monoCol(), monoCol()];
    const wf = buildTrackPreviewWaveform(makeRow({
      preview_format: 'mono',
      preview_columns: cols,
      preview_column_count: 2,
    }));
    expect(wf.previewColumnsValid).toBe(true);
    expect(wf.inferredFormat).toBe('mono');
  });

  it('sets previewColumnsValid false for malformed columns but does not throw', () => {
    const wf = buildTrackPreviewWaveform(makeRow({
      preview_columns: ['bad', 'data'] as unknown as [],
      preview_column_count: 2,
    }));
    expect(wf.previewColumnsValid).toBe(false);
    expect(wf.inferredFormat).toBeNull();
  });

  it('exposes detail storage fields', () => {
    const wf = buildTrackPreviewWaveform(makeRow({
      detail_storage_bucket: 'waveforms',
      detail_storage_path: 'users/abc/wf.bin',
    }));
    expect(wf.detailStorageBucket).toBe('waveforms');
    expect(wf.detailStoragePath).toBe('users/abc/wf.bin');
  });

  it('handles null preview_columns gracefully', () => {
    const wf = buildTrackPreviewWaveform(makeRow({ preview_columns: null as unknown as [] }));
    expect(wf.previewColumnsValid).toBe(false);
  });
});

// ── chunkIds ───────────────────────────────────────────────────────────────────

describe('chunkIds — empty input', () => {
  it('returns empty array for empty input', () => {
    expect(chunkIds([], 100)).toEqual([]);
  });

  it('returns empty array when size ≤ 0', () => {
    expect(chunkIds(['a', 'b'], 0)).toEqual([]);
  });
});

describe('chunkIds — deduplication', () => {
  it('deduplicates before chunking', () => {
    const chunks = chunkIds(['a', 'b', 'a', 'b', 'c'], 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
    expect(new Set(chunks[0]).size).toBe(3);
  });

  it('duplicate IDs produce same result as unique list', () => {
    expect(chunkIds(['x', 'x', 'x'], 10)).toEqual(chunkIds(['x'], 10));
  });
});

describe('chunkIds — one chunk', () => {
  it('returns a single chunk when all IDs fit', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it('exactly at chunk size boundary stays in one chunk', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids, 200)).toHaveLength(1);
  });
});

describe('chunkIds — multiple chunks', () => {
  it('splits into correct number of chunks', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 200);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[1]).toHaveLength(200);
    expect(chunks[2]).toHaveLength(50);
  });

  it('every id appears exactly once across all chunks', () => {
    const ids = Array.from({ length: 350 }, (_, i) => `t-${i}`);
    const flat = chunkIds(ids, 100).flat();
    expect(flat).toHaveLength(350);
    expect(new Set(flat).size).toBe(350);
  });
});
