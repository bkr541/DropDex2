import { supabase } from '../supabase';
import type { RekordboxImport, RekordboxTrack, RekordboxPlaylist, RekordboxUserSettings } from '../../types';
import {
  BPM_TOLERANCE_DEFAULT,
  SIMILAR_CANDIDATE_FETCH_LIMIT,
  hasSimilarVibesSignal,
  rankSimilarTracks,
  shouldUseBpm,
} from '../music/similarVibes';
import { getCompatibleCamelotKeys } from '../music/camelot';

export interface PlaylistWithCount extends RekordboxPlaylist {
  track_count: number;
}

export interface PlaylistTrackItem {
  position: number;
  track: RekordboxTrack;
}

export async function fetchLatestImport(userId: string): Promise<RekordboxImport | null> {
  const { data, error } = await supabase
    .from('rekordbox_imports')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as RekordboxImport | null;
}

export async function fetchActiveImport(userId: string): Promise<RekordboxImport | null> {
  // Try the user's explicitly chosen active import first
  const { data: settings } = await supabase
    .from('rekordbox_user_settings')
    .select('active_import_id')
    .eq('user_id', userId)
    .maybeSingle();

  const activeId = (settings as RekordboxUserSettings | null)?.active_import_id;
  if (activeId) {
    const { data: imp } = await supabase
      .from('rekordbox_imports')
      .select('*')
      .eq('id', activeId)
      .eq('status', 'completed')
      .maybeSingle();
    if (imp) return imp as RekordboxImport;
  }

  // Fallback: newest completed import
  return fetchLatestImport(userId);
}

export async function fetchAllImports(userId: string): Promise<RekordboxImport[]> {
  const { data, error } = await supabase
    .from('rekordbox_imports')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('imported_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as RekordboxImport[];
}

export async function setActiveImport(importId: string): Promise<void> {
  const { error } = await supabase.rpc('set_active_import', { p_import_id: importId });
  if (error) throw new Error(error.message);
}

export async function deleteImport(importId: string): Promise<void> {
  const { error } = await supabase
    .from('rekordbox_imports')
    .delete()
    .eq('id', importId);
  if (error) throw new Error(error.message);
}

export async function fetchPlaylists(importId: string): Promise<PlaylistWithCount[]> {
  const { data: playlists, error: pErr } = await supabase
    .from('rekordbox_playlists')
    .select('*')
    .eq('import_id', importId)
    .order('sort_order', { ascending: true, nullsFirst: false });

  if (pErr) throw new Error(pErr.message);
  if (!playlists?.length) return [];

  const playlistIds = playlists.map((p) => p.id as string);

  // Paginate to avoid the 1,000-row PostgREST cap — a library with many
  // tracks across many playlists can easily exceed it.
  const PAGE_SIZE = 1000;
  const allPtRows: { playlist_id: string }[] = [];
  let start = 0;
  while (true) {
    const { data: page, error: ptErr } = await supabase
      .from('rekordbox_playlist_tracks')
      .select('playlist_id')
      .in('playlist_id', playlistIds)
      .order('playlist_id')
      .range(start, start + PAGE_SIZE - 1);

    if (ptErr) throw new Error(ptErr.message);
    if (page?.length) allPtRows.push(...page);
    if (!page?.length || page.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  const countMap: Record<string, number> = {};
  for (const row of allPtRows) {
    countMap[row.playlist_id] = (countMap[row.playlist_id] ?? 0) + 1;
  }

  return (playlists as unknown as RekordboxPlaylist[]).map((p) => ({
    ...p,
    track_count: countMap[p.id] ?? 0,
  }));
}

export async function fetchPlaylistTracks(playlistId: string): Promise<PlaylistTrackItem[]> {
  const { data, error } = await supabase
    .from('rekordbox_playlist_tracks')
    .select('position, track:rekordbox_tracks!track_id(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{ position: number; track: unknown }>)
    .filter((row) => row.track != null)
    .map((row) => ({
      position: row.position,
      track: row.track as RekordboxTrack,
    }));
}

export async function searchTracks(
  importId: string,
  query: string,
): Promise<RekordboxTrack[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .or(`title.ilike.%${q}%,artist.ilike.%${q}%,genre.ilike.%${q}%`)
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as RekordboxTrack[];
}

export async function fetchRecentTracks(importId: string): Promise<RekordboxTrack[]> {
  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .order('date_added', { ascending: false, nullsFirst: false })
    .limit(8);

  if (error) throw new Error(error.message);
  return (data ?? []) as RekordboxTrack[];
}

export async function fetchReviewTracks(importId: string): Promise<RekordboxTrack[]> {
  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .order('date_added', { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as RekordboxTrack[];
}

export interface TrackStatRow {
  id: string;
  import_id: string;
  rekordbox_content_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
  musical_key: string | null;
  camelot_key: string | null;
  date_added: string | null;
  duration_seconds: number | null;
  file_path: string | null;
  file_format: string | null;
}

export async function fetchTrackStats(importId: string): Promise<TrackStatRow[]> {
  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select(
      'id, import_id, rekordbox_content_id, title, artist, genre, bpm, musical_key, camelot_key, date_added, duration_seconds, file_path, file_format',
    )
    .eq('import_id', importId)
    .order('date_added', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TrackStatRow[];
}

/** Map a lightweight TrackStatRow (from fetchTrackStats) to a full RekordboxTrack shape. */
export function trackStatRowToTrack(row: TrackStatRow): RekordboxTrack {
  return {
    id: row.id,
    import_id: row.import_id,
    rekordbox_content_id: row.rekordbox_content_id,
    title: row.title,
    artist: row.artist,
    album: null,
    remixer: null,
    genre: row.genre,
    label: null,
    musical_key: row.musical_key,
    camelot_key: row.camelot_key,
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm: row.bpm,
    duration_seconds: row.duration_seconds,
    rating: null,
    comments: null,
    file_path: row.file_path,
    file_format: row.file_format,
    date_added: row.date_added,
    created_at: '',
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
  };
}

export interface TrackPlaylistMembership {
  position: number;
  playlist: RekordboxPlaylist;
}

export async function fetchTrackPlaylists(
  importId: string,
  trackId: string,
): Promise<TrackPlaylistMembership[]> {
  const { data, error } = await supabase
    .from('rekordbox_playlist_tracks')
    .select('position, playlist:rekordbox_playlists!playlist_id(*)')
    .eq('track_id', trackId);

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{ position: number; playlist: unknown }>)
    .filter((row) => {
      if (row.playlist == null) return false;
      return (row.playlist as RekordboxPlaylist).import_id === importId;
    })
    .map((row) => ({
      position: row.position,
      playlist: row.playlist as RekordboxPlaylist,
    }))
    .sort((a, b) => a.playlist.name.localeCompare(b.playlist.name));
}

/**
 * Fetch tracks that are Camelot-compatible and/or within BPM tolerance.
 * Uses camelot_key for harmonic matching (compatible codes via the Camelot wheel).
 * Returns raw candidate rows — caller is responsible for scoring and ranking.
 */
export async function fetchCamelotCompatibleTracks(
  importId: string,
  track: Pick<RekordboxTrack, 'id' | 'camelot_key' | 'bpm'>,
  bpmTolerance = BPM_TOLERANCE_DEFAULT,
  limit = SIMILAR_CANDIDATE_FETCH_LIMIT,
): Promise<RekordboxTrack[]> {
  const { camelot_key, bpm: rawBpm, id } = track;

  if (!hasSimilarVibesSignal(camelot_key, rawBpm)) return [];

  let query = supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .neq('id', id);

  if (camelot_key) {
    const compatible = getCompatibleCamelotKeys(camelot_key).map((k) => k.code);
    if (compatible.length > 0) {
      query = query.in('camelot_key', compatible);
    }
  }

  if (shouldUseBpm(rawBpm)) {
    query = query
      .gte('bpm', rawBpm - bpmTolerance)
      .lte('bpm', rawBpm + bpmTolerance)
      .not('bpm', 'is', null);
  }

  const { data, error } = await query.limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []) as RekordboxTrack[];
}

/**
 * Legacy similar tracks query. Delegates to fetchCamelotCompatibleTracks and
 * applies the legacy BPM-only ranking. Prefer the new hook (useSimilarTracks)
 * which uses scoreCandidate + mergeCandidates + rankScoredCandidates.
 *
 * @deprecated Use fetchCamelotCompatibleTracks + scoreCandidate pipeline instead.
 */
export async function fetchSimilarTracks(
  importId: string,
  track: Pick<RekordboxTrack, 'id' | 'musical_key' | 'bpm'> & { camelot_key?: string | null },
  bpmTolerance = BPM_TOLERANCE_DEFAULT,
): Promise<RekordboxTrack[]> {
  const candidates = await fetchCamelotCompatibleTracks(
    importId,
    { id: track.id, camelot_key: track.camelot_key ?? null, bpm: track.bpm },
    bpmTolerance,
  );

  return rankSimilarTracks(candidates, track.id, track.bpm, bpmTolerance);
}
