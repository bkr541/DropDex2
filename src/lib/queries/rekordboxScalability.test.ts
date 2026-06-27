import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';

vi.mock('../supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '../supabase';
import {
  fetchLibraryStats,
  fetchLibraryTracksPage,
  fetchPlaylistStats,
  fetchPlaylistTracksPage,
} from './rekordbox';

const rpcMock = supabase.rpc as ReturnType<typeof vi.fn>;

function makeTrack(index: number, overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: `track-${String(index).padStart(4, '0')}`,
    import_id: 'import-owner',
    rekordbox_content_id: String(index),
    title: `Track ${index}`,
    artist: `Artist ${index % 10}`,
    album: null,
    remixer: null,
    genre: index === 1500 ? 'Beyond First Thousand' : `Genre ${index % 5}`,
    label: null,
    musical_key: index === 1500 ? '12A' : '8A',
    camelot_key: index === 1500 ? '12A' : '8A',
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm: index === 1500 ? 150 : 128,
    duration_seconds: index === 1500 ? 999 : 180,
    rating: null,
    comments: null,
    file_path: `/music/${index}.wav`,
    file_format: 'WAV',
    date_added: '2026-06-27',
    created_at: '2026-06-27T00:00:00Z',
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

const libraryTracks = Array.from({ length: 1501 }, (_, index) => makeTrack(index));
const playlistPlacements = libraryTracks.map((track, index) => ({
  position: index + 1,
  track,
}));

function installScalabilityRpcSimulation() {
  rpcMock.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    if (name === 'get_rekordbox_library_track_page') {
      const search = typeof params.p_search === 'string' ? params.p_search.toLowerCase() : '';
      const genre = typeof params.p_genre === 'string' ? params.p_genre : null;
      const artist = typeof params.p_artist === 'string' ? params.p_artist : null;
      const offset = Number(params.p_offset ?? 0);
      const limit = Number(params.p_limit ?? 200);
      const filtered = libraryTracks
        .filter((track) => !search || [track.title, track.artist, track.genre]
          .some((value) => value?.toLowerCase().includes(search)))
        .filter((track) => !genre || track.genre === genre)
        .filter((track) => !artist || track.artist === artist)
        .sort((a, b) => {
          const dateCompare = (b.date_added ?? '').localeCompare(a.date_added ?? '');
          return dateCompare || a.id.localeCompare(b.id);
        });
      return {
        data: {
          items: filtered.slice(offset, offset + limit),
          total: filtered.length,
          offset,
          limit,
        },
        error: null,
      };
    }

    if (name === 'get_rekordbox_playlist_track_page') {
      const offset = Number(params.p_offset ?? 0);
      const limit = Number(params.p_limit ?? 200);
      return {
        data: {
          items: playlistPlacements.slice(offset, offset + limit),
          total: playlistPlacements.length,
          offset,
          limit,
        },
        error: null,
      };
    }

    if (name === 'get_rekordbox_library_stats') {
      const totalDuration = libraryTracks.reduce((sum, track) => sum + (track.duration_seconds ?? 0), 0);
      return {
        data: {
          total_track_count: libraryTracks.length,
          total_duration_seconds: totalDuration,
          average_bpm: 128.01,
          most_common_bpm: 128,
          most_common_key: '8A',
          genre_totals: [
            { name: 'Genre 0', count: 300 },
            { name: 'Beyond First Thousand', count: 1 },
          ],
          artist_totals: [{ name: 'Artist 0', count: 151 }],
          bpm_totals: [{ bpm: 128, count: 1500 }, { bpm: 150, count: 1 }],
          key_totals: [{ name: '8A', count: 1500 }, { name: '12A', count: 1 }],
        },
        error: null,
      };
    }

    if (name === 'get_rekordbox_playlist_stats') {
      return {
        data: {
          track_count: playlistPlacements.length,
          total_duration_seconds: playlistPlacements.reduce(
            (sum, placement) => sum + (placement.track.duration_seconds ?? 0),
            0,
          ),
          average_bpm: 128.01,
          most_common_key: '8A',
        },
        error: null,
      };
    }

    return { data: null, error: { message: `Unexpected RPC ${name}` } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installScalabilityRpcSimulation();
});

describe('library pagination at the 1,000-row boundary', () => {
  it('retrieves tracks after row 1,000 from a 1,501-track library', async () => {
    const page = await fetchLibraryTracksPage('import-owner', 1000, 200);
    expect(page.total).toBe(1501);
    expect(page.items).toHaveLength(200);
    expect(page.items[0].id).toBe('track-1000');
    expect(page.items.at(-1)?.id).toBe('track-1199');
    expect(page.hasMore).toBe(true);
  });

  it('reaches the final track', async () => {
    const page = await fetchLibraryTracksPage('import-owner', 1500, 200);
    expect(page.items.map((track) => track.id)).toEqual(['track-1500']);
    expect(page.hasMore).toBe(false);
  });

  it('keeps deterministic ordering across adjacent pages', async () => {
    const first = await fetchLibraryTracksPage('import-owner', 0, 200);
    const second = await fetchLibraryTracksPage('import-owner', 200, 200);
    const ids = [...first.items, ...second.items].map((track) => track.id);

    expect(ids).toHaveLength(400);
    expect(new Set(ids).size).toBe(400);
    expect(ids[199]).toBe('track-0199');
    expect(ids[200]).toBe('track-0200');
  });

  it('applies search before pagination so a match beyond row 1,000 is found', async () => {
    const page = await fetchLibraryTracksPage('import-owner', 0, 200, {
      search: 'Beyond First Thousand',
    });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('track-1500');
  });

  it('applies filters across the complete library', async () => {
    const page = await fetchLibraryTracksPage('import-owner', 0, 200, {
      genre: 'Beyond First Thousand',
    });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('track-1500');
  });
});

describe('playlist pagination at the 1,000-placement boundary', () => {
  it('retrieves placements after row 1,000 and reaches placement 1,501', async () => {
    const middle = await fetchPlaylistTracksPage('playlist-owner', 1000, 200);
    const last = await fetchPlaylistTracksPage('playlist-owner', 1500, 200);

    expect(middle.total).toBe(1501);
    expect(middle.items[0].position).toBe(1001);
    expect(last.items).toHaveLength(1);
    expect(last.items[0].position).toBe(1501);
    expect(last.hasMore).toBe(false);
  });

  it('preserves duplicate track placements at different playlist positions', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        items: [
          { position: 10, track: libraryTracks[0] },
          { position: 20, track: libraryTracks[0] },
        ],
        total: 2,
        offset: 0,
        limit: 200,
      },
      error: null,
    });

    const page = await fetchPlaylistTracksPage('playlist-owner', 0, 200);
    expect(page.items.map((placement) => placement.position)).toEqual([10, 20]);
    expect(page.items[0].track.id).toBe(page.items[1].track.id);
  });
});

describe('database aggregate contracts', () => {
  it('library statistics include rows after 1,000', async () => {
    const stats = await fetchLibraryStats('import-owner');
    expect(stats.totalTrackCount).toBe(1501);
    expect(stats.totalDurationSeconds).toBe(1500 * 180 + 999);
    expect(stats.genreTotals).toContainEqual({ name: 'Beyond First Thousand', count: 1 });
    expect(stats.bpmTotals).toContainEqual({ bpm: 150, count: 1 });
    expect(stats.keyTotals).toContainEqual({ name: '12A', count: 1 });
  });

  it('playlist statistics include all 1,501 placements', async () => {
    const stats = await fetchPlaylistStats('playlist-owner');
    expect(stats.trackCount).toBe(1501);
    expect(stats.totalDurationSeconds).toBe(1500 * 180 + 999);
    expect(stats.averageBpm).toBe(128.01);
    expect(stats.mostCommonKey).toBe('8A');
  });

  it('does not convert an authorization failure into empty statistics', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not authorized to read this Rekordbox import' },
    });

    await expect(fetchLibraryStats('import-other-user')).rejects.toThrow('Not authorized');
  });
});
