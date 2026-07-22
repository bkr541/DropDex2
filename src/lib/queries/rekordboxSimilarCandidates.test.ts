import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';

vi.mock('../supabase', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { supabase } from '../supabase';
import { fetchCamelotCompatibleTracks } from './rekordbox';

const rpcMock = supabase.rpc as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as ReturnType<typeof vi.fn>;

function makeTrack(overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: 'selected-track',
    import_id: 'import-1',
    rekordbox_content_id: '1',
    title: 'Selected',
    artist: null,
    album: null,
    remixer: null,
    genre: 'Bass House',
    label: 'Night Bass',
    musical_key: 'A minor',
    camelot_key: '8A',
    normalized_key_name: 'A minor',
    key_tonic: 'A',
    key_mode: 'minor',
    bpm: 128,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: null,
    file_format: null,
    date_added: null,
    created_at: '2026-07-21T00:00:00Z',
    master_db_id: null,
    master_content_id: null,
    analysis_data_file_path: null,
    analysed_bits: null,
    cue_update_count: null,
    analysis_data_update_count: null,
    information_update_count: null,
    analysis_reused_from_track_id: null,
    analysis_parse_status: null,
    analysis_parse_warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchCamelotCompatibleTracks', () => {
  it('asks Postgres for a deterministic union-ranked candidate pool', async () => {
    const candidate = makeTrack({ id: 'candidate', title: 'Candidate' });
    rpcMock.mockResolvedValueOnce({ data: [candidate], error: null });

    const result = await fetchCamelotCompatibleTracks('import-1', makeTrack(), 2, 40);

    expect(result).toEqual([candidate]);
    expect(rpcMock).toHaveBeenCalledWith('get_rekordbox_similar_vibe_candidates', {
      p_import_id: 'import-1',
      p_selected_track_id: 'selected-track',
      p_compatible_camelot_keys: ['8A', '8B', '9A', '7A', '10A'],
      p_selected_bpm: 128,
      p_bpm_tolerance: 2,
      p_selected_genre: 'Bass House',
      p_selected_label: 'Night Bass',
      p_limit: 40,
    });
  });

  it('does not query when neither a key nor usable BPM exists', async () => {
    const result = await fetchCamelotCompatibleTracks(
      'import-1',
      makeTrack({ camelot_key: null, bpm: null }),
    );

    expect(result).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('surfaces non-schema RPC failures instead of returning a partial candidate set', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'RPC unavailable' } });

    await expect(fetchCamelotCompatibleTracks('import-1', makeTrack()))
      .rejects.toThrow('RPC unavailable');
  });

  it('falls back to a direct harmonic and tempo query when the RPC migration is missing', async () => {
    const candidate = makeTrack({ id: 'candidate', title: 'Candidate', bpm: 129 });
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    });
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      or: vi.fn(),
      limit: vi.fn(),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.neq.mockReturnValue(builder);
    builder.or.mockReturnValue(builder);
    builder.limit.mockResolvedValue({ data: [candidate], error: null });
    fromMock.mockReturnValueOnce(builder);

    const result = await fetchCamelotCompatibleTracks('import-1', makeTrack(), 2, 40);

    expect(fromMock).toHaveBeenCalledWith('rekordbox_tracks');
    expect(builder.or).toHaveBeenCalled();
    expect(result).toEqual([candidate]);
  });
});
