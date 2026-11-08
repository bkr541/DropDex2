import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackBeatGrid, fetchTrackCues, fetchTrackPhrases } from '../../lib/queries/analysisData';
import { fetchLibraryTracksPage, fetchTracksByIds } from '../../lib/queries/rekordbox';
import { fetchRekordboxRecommendationEdges } from '../../lib/queries/recommendations';
import type { RekordboxTrack } from '../../types';
import { loadSetLabCandidatePool } from './candidateProvider';
import { createSetLabDraft } from './session';
import { scope } from './session.testFixtures';

vi.mock('../../lib/queries/analysisData');
vi.mock('../../lib/queries/rekordbox');
vi.mock('../../lib/queries/recommendations');

const row = (id: string, genre: string, bpm: number): RekordboxTrack => ({
  id, title: id, import_id: scope.sourceImportId, rekordbox_content_id: id,
  bpm, genre, camelot_key: null, label: null, artist: null, album: null, remixer: null,
  musical_key: null, normalized_key_name: null, key_tonic: null, key_mode: null,
  duration_seconds: null, rating: null, comments: null, file_path: null, file_format: null, date_added: null,
  source_metadata: { unused: true }, created_at: '2024-01-01T00:00:00Z',
  master_db_id: null, master_content_id: null, analysis_data_file_path: null, analysed_bits: null,
  cue_update_count: null, analysis_data_update_count: null, information_update_count: null,
  analysis_reused_from_track_id: null, analysis_parse_status: null, analysis_parse_warnings: [],
});
const usb = { status: 'disconnected', volumeName: null, resolveTrackSource: vi.fn() } as const;
const filters = createSetLabDraft(scope).filters;
const pages = vi.mocked(fetchLibraryTracksPage);
const makePage = (items: RekordboxTrack[], offset: number, total: number) => ({
  items, offset, total, limit: 500, hasMore: offset + items.length < total,
});

beforeEach(() => vi.resetAllMocks());

describe('Set Lab candidate provider', () => {
  it('walks every page, keeps only the compact filtered roster and reads fixed tracks outside it', async () => {
    const signal = new AbortController().signal;
    pages.mockResolvedValueOnce(makePage([row('low', 'House', 80), row('other', 'Pop', 125)], 0, 4))
      .mockResolvedValueOnce(makePage([row('valid-late', 'House', 125), row('valid-other', 'Techno', 140)], 2, 4));
    vi.mocked(fetchTracksByIds).mockResolvedValueOnce([row('fixed', 'Pop', 77)]);
    const pool = await loadSetLabCandidatePool({
      scope, filters: { search: 'night', genres: ['House', 'Techno'], minBpm: 100, maxBpm: 145 }, fixedIds: ['fixed'], usb, signal,
    });
    expect(pages.mock.calls).toEqual([
      [scope.sourceImportId, 0, 500, { search: 'night', genre: null }, signal],
      [scope.sourceImportId, 2, 500, { search: 'night', genre: null }, signal],
    ]);
    expect(pool.candidates.map(({ id }) => id)).toEqual(['valid-late', 'valid-other']);
    expect(pool.tracksById.get('fixed')?.identity).toBe('c:fixed');
    expect(pool.candidates[0]).not.toHaveProperty('source_metadata');
    expect(fetchTrackBeatGrid).not.toHaveBeenCalled();
    expect(usb.resolveTrackSource).not.toHaveBeenCalled();
  });

  it('passes a single genre to the library filter model and resolves analysis only on preflight', async () => {
    pages.mockResolvedValueOnce(makePage([row('late', 'House', 125)], 0, 1));
    vi.mocked(fetchTrackBeatGrid).mockResolvedValueOnce(null);
    const pool = await loadSetLabCandidatePool({ scope, filters: { ...filters, genres: ['House'] }, fixedIds: [], usb });
    expect(pages).toHaveBeenCalledWith(scope.sourceImportId, 0, 500, { search: '', genre: 'House' }, undefined);
    expect(fetchTrackBeatGrid).not.toHaveBeenCalled();
    await expect(pool.preflight(pool.candidates[0], 8)).resolves.toMatchObject({ ok: false, explanation: expect.stringContaining('no imported') });
    expect(fetchTrackBeatGrid).toHaveBeenCalledWith('late', undefined);
    expect(fetchTrackCues).not.toHaveBeenCalled();
    expect(fetchTrackPhrases).not.toHaveBeenCalled();
  });

  it('preserves original recommendation evidence and excludes other imports and filtered tracks', async () => {
    const signal = new AbortController().signal;
    pages.mockResolvedValueOnce(makePage([row('from', 'House', 125), row('to', 'House', 125)], 0, 2));
    const edge = (id: string, rating: number, importId = scope.sourceImportId) => ({
      id, import_id: importId, source_track_id: 'from', target_track_id: 'to', rating,
      source_created_at: null, relationship_source: 'recommended_like', direction_preserved: true,
    });
    vi.mocked(fetchRekordboxRecommendationEdges).mockResolvedValueOnce([
      { otherTrackId: 'to', direction: 'reciprocal', edge: edge('low', 1) },
      { otherTrackId: 'to', direction: 'reciprocal', edge: edge('high', 5) },
      { otherTrackId: 'to', direction: 'incoming', edge: edge('foreign', 10, 'foreign') },
      { otherTrackId: 'filtered', direction: 'outgoing', edge: edge('filtered', 10) },
    ]);
    const pool = await loadSetLabCandidatePool({ scope, filters, fixedIds: [], usb, signal });
    const result = await pool.recommendations('from');
    expect(result).toEqual(new Map([['to', { direction: 'reciprocal', rating: 5, createdAt: null }]]));
    expect(fetchRekordboxRecommendationEdges).toHaveBeenCalledWith(scope.sourceImportId, 'from', { signal, allPages: true });
  });

  it('rejects a changing or incomplete page and suppresses subsequent work on abort', async () => {
    pages.mockResolvedValueOnce(makePage([], 0, 3));
    await expect(loadSetLabCandidatePool({ scope, filters, fixedIds: [], usb })).rejects.toThrow('changed');
    const controller = new AbortController();
    pages.mockImplementationOnce(async () => {
      controller.abort();
      return makePage([row('aborted', 'House', 125)], 0, 2);
    });
    await expect(loadSetLabCandidatePool({ scope, filters, fixedIds: [], usb, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(pages).toHaveBeenCalledTimes(2);
  });
});
