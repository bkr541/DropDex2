/**
 * Tests for fetchTrackPreviewWaveforms — focusing on the bulk-fetch result shape
 * and the distinction between confirmed-absent IDs and failed-chunk IDs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────

vi.mock('../supabase', () => {
  const mockChain = { select: vi.fn(), in: vi.fn() };
  const mockFrom = vi.fn().mockReturnValue(mockChain);
  return { supabase: { from: mockFrom } };
});

// ── Import after mock setup ───────────────────────────────────────────────────

import { fetchTrackPreviewWaveforms } from './analysisData';
import { supabase } from '../supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorCol(h = 100, r = 50, g = 60, b = 70) {
  return { h, r, g, b };
}

function makeWaveformRow(trackId: string) {
  return {
    id: `wf-${trackId}`,
    import_id: 'imp-1',
    track_id: trackId,
    preview_format: 'color',
    preview_column_count: 1,
    preview_columns: [colorCol()],
    detail_format: null,
    detail_column_count: null,
    detail_storage_bucket: null,
    detail_storage_path: null,
    parser_version: '1.0',
  };
}

// Build a chainable query stub and wire it into the mock.
function setupChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const chain = { select: vi.fn(), in: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.in.mockResolvedValue(result);
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the default chain to prevent stale mock return values.
  const defaultChain = { select: vi.fn(), in: vi.fn() };
  defaultChain.select.mockReturnValue(defaultChain);
  defaultChain.in.mockResolvedValue({ data: [], error: null });
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(defaultChain);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchTrackPreviewWaveforms', () => {
  it('returns empty result for empty input', async () => {
    const result = await fetchTrackPreviewWaveforms([]);
    expect(result.waveforms.size).toBe(0);
    expect(result.successfulTrackIds.size).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('all chunks successful — waveforms returned, successfulTrackIds populated', async () => {
    setupChain({
      data: [makeWaveformRow('track-a'), makeWaveformRow('track-b')],
      error: null,
    });

    const result = await fetchTrackPreviewWaveforms(['track-a', 'track-b']);

    expect(result.errors).toHaveLength(0);
    expect(result.waveforms.size).toBe(2);
    expect(result.waveforms.has('track-a')).toBe(true);
    expect(result.waveforms.has('track-b')).toBe(true);
    expect(result.successfulTrackIds.has('track-a')).toBe(true);
    expect(result.successfulTrackIds.has('track-b')).toBe(true);
  });

  it('successful chunk with one track having no waveform row — ID in successfulTrackIds but not waveforms', async () => {
    setupChain({
      data: [makeWaveformRow('track-a')],
      error: null,
    });

    const result = await fetchTrackPreviewWaveforms(['track-a', 'track-b']);

    expect(result.errors).toHaveLength(0);
    expect(result.waveforms.has('track-a')).toBe(true);
    expect(result.waveforms.has('track-b')).toBe(false);
    // Both IDs were in a successful chunk, so both are in successfulTrackIds.
    expect(result.successfulTrackIds.has('track-a')).toBe(true);
    expect(result.successfulTrackIds.has('track-b')).toBe(true);
  });

  it('failed chunk — IDs NOT in successfulTrackIds, error reported with trackIds', async () => {
    setupChain({ data: null, error: { message: 'connection refused' } });

    const result = await fetchTrackPreviewWaveforms(['track-a', 'track-b']);

    expect(result.waveforms.size).toBe(0);
    expect(result.successfulTrackIds.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('connection refused');
    expect(result.errors[0].trackIds).toEqual(expect.arrayContaining(['track-a', 'track-b']));
    expect(result.errors[0].chunkIndex).toBe(0);
  });

  it('one chunk succeeds, another fails — successfulTrackIds only contains successful chunk IDs', async () => {
    const successChain = { select: vi.fn(), in: vi.fn() };
    successChain.select.mockReturnValue(successChain);
    successChain.in.mockResolvedValue({ data: [makeWaveformRow('track-good')], error: null });

    const failChain = { select: vi.fn(), in: vi.fn() };
    failChain.select.mockReturnValue(failChain);
    failChain.in.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(successChain)
      .mockReturnValueOnce(failChain);

    // First chunk: 200 IDs (all in successChain). Second chunk: 1 ID (in failChain).
    // 'track-good' is in the first chunk. 'track-fail' is the sole second-chunk ID.
    const firstChunk = ['track-good', ...Array.from({ length: 199 }, (_, i) => `track-filler-${i}`)];
    const ids = [...firstChunk, 'track-fail'];
    const result = await fetchTrackPreviewWaveforms(ids);

    expect(result.waveforms.has('track-good')).toBe(true);
    expect(result.successfulTrackIds.has('track-good')).toBe(true);
    expect(result.successfulTrackIds.has('track-filler-0')).toBe(true); // first chunk succeeded
    expect(result.successfulTrackIds.has('track-fail')).toBe(false);    // second chunk failed
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('timeout');
    expect(result.errors[0].trackIds).toEqual(['track-fail']);
  });

  it('malformed waveform data in a successful chunk does not affect the successfulTrackIds set', async () => {
    const badRow = {
      ...makeWaveformRow('track-bad'),
      preview_columns: [{ not: 'a column' }],
    };
    setupChain({ data: [badRow], error: null });

    const result = await fetchTrackPreviewWaveforms(['track-bad']);

    // Chunk succeeded (no error), so track-bad is in successfulTrackIds.
    expect(result.successfulTrackIds.has('track-bad')).toBe(true);
    // A waveform row was returned (even with invalid columns), so it IS in waveforms.
    expect(result.waveforms.has('track-bad')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('deduplicates input IDs before querying', async () => {
    const chain = setupChain({ data: [], error: null });

    await fetchTrackPreviewWaveforms(['track-a', 'track-a', 'track-a']);

    expect(chain.in).toHaveBeenCalledTimes(1);
    const calledWith = chain.in.mock.calls[0][1];
    expect(calledWith).toEqual(['track-a']);
  });

  it('multiple chunks all fail — all IDs in error.trackIds, none in successfulTrackIds', async () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const c = { select: vi.fn(), in: vi.fn() };
      c.select.mockReturnValue(c);
      c.in.mockResolvedValue({ data: null, error: { message: 'db down' } });
      return c;
    });

    const ids = Array.from({ length: 201 }, (_, i) => `track-${i}`);
    const result = await fetchTrackPreviewWaveforms(ids);

    expect(result.waveforms.size).toBe(0);
    expect(result.successfulTrackIds.size).toBe(0);
    expect(result.errors).toHaveLength(2);
    const allFailedIds = result.errors.flatMap((e) => e.trackIds);
    expect(allFailedIds).toHaveLength(201);
  });

  it('failed chunk retried successfully — second call succeeds and IDs enter successfulTrackIds', async () => {
    // First call fails.
    const failChain = { select: vi.fn(), in: vi.fn() };
    failChain.select.mockReturnValue(failChain);
    failChain.in.mockResolvedValue({ data: null, error: { message: 'transient' } });

    // Second call succeeds.
    const successChain = { select: vi.fn(), in: vi.fn() };
    successChain.select.mockReturnValue(successChain);
    successChain.in.mockResolvedValue({ data: [makeWaveformRow('track-retry')], error: null });

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(failChain)
      .mockReturnValueOnce(successChain);

    // First call — fails.
    const first = await fetchTrackPreviewWaveforms(['track-retry']);
    expect(first.errors).toHaveLength(1);
    expect(first.successfulTrackIds.size).toBe(0);

    // Second call (retry) — succeeds.
    const second = await fetchTrackPreviewWaveforms(['track-retry']);
    expect(second.errors).toHaveLength(0);
    expect(second.waveforms.has('track-retry')).toBe(true);
    expect(second.successfulTrackIds.has('track-retry')).toBe(true);
  });
});
