import { supabase } from '../supabase';
import { chunkIds } from './waveformValidation';

/** Few enough tracks per request that one page of rows is rarely exceeded. */
const TRACK_CHUNK_SIZE = 40;
const PAGE_SIZE = 1000;

export interface PlaylistPlacementRow {
  track_id: string;
  playlist_id: string;
}

/**
 * How many different playlists each track is in. A track placed twice in the same playlist
 * counts once. Every requested track gets an entry, 0 when it is in no playlist.
 */
export function countPlaylistsPerTrack(
  rows: ReadonlyArray<PlaylistPlacementRow>,
  trackIds: ReadonlyArray<string>,
): Map<string, number> {
  const playlistsByTrack = new Map<string, Set<string>>(trackIds.map((id) => [id, new Set<string>()]));
  for (const row of rows) playlistsByTrack.get(row.track_id)?.add(row.playlist_id);
  return new Map([...playlistsByTrack].map(([id, playlists]) => [id, playlists.size] as const));
}

/**
 * Playlist counts for a set of tracks. Reads only the signed-in user's own playlists, since
 * the table is protected per user, and a track belongs to a single import, so the counts
 * are for that track's own USB library.
 */
export async function fetchTrackPlaylistCounts(trackIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(trackIds)].filter(Boolean);
  const rows: PlaylistPlacementRow[] = [];
  await Promise.all(chunkIds(unique, TRACK_CHUNK_SIZE).map(async (chunk) => {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('rekordbox_playlist_tracks')
        .select('track_id, playlist_id')
        .in('track_id', chunk)
        .order('playlist_id', { ascending: true })
        .order('position', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message || 'Playlist counts could not be loaded.');
      if (!Array.isArray(data)) throw new Error('Playlist counts came back in an unexpected shape.');
      rows.push(...(data as PlaylistPlacementRow[]));
      if (data.length < PAGE_SIZE) break;
    }
  }));
  return countPlaylistsPerTrack(rows, unique);
}
