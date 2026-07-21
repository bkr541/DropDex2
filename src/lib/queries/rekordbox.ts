import { supabase } from '../supabase';
import type { RekordboxImport, RekordboxTrack, RekordboxPlaylist, RekordboxUserSettings } from '../../types';

// Re-export so existing callers don't need to change import paths.
export type { TrackStatRow } from '../rekordbox/trackMappers';
export { trackStatRowToTrack } from '../rekordbox/trackMappers';
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

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface LibraryTrackFilters {
  search?: string | null;
  genre?: string | null;
  artist?: string | null;
}

export interface NamedStatTotal {
  name: string;
  count: number;
}

export interface BpmStatTotal {
  bpm: number;
  count: number;
}

export interface LibraryStats {
  totalTrackCount: number;
  totalDurationSeconds: number;
  averageBpm: number | null;
  mostCommonBpm: number | null;
  mostCommonKey: string | null;
  genreTotals: NamedStatTotal[];
  artistTotals: NamedStatTotal[];
  bpmTotals: BpmStatTotal[];
  keyTotals: NamedStatTotal[];
}

export interface PlaylistStats {
  trackCount: number;
  totalDurationSeconds: number;
  averageBpm: number | null;
  mostCommonKey: string | null;
}

export const LIBRARY_TRACK_PAGE_SIZE = 200;
export const PLAYLIST_TRACK_PAGE_SIZE = 200;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNamedTotals(value: unknown): NamedStatTotal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = asRecord(entry);
    const name = typeof row.name === 'string' ? row.name : '';
    if (!name) return [];
    return [{ name, count: asFiniteNumber(row.count) }];
  });
}

function parseBpmTotals(value: unknown): BpmStatTotal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = asRecord(entry);
    const bpm = asFiniteNumber(row.bpm, Number.NaN);
    if (!Number.isFinite(bpm)) return [];
    return [{ bpm, count: asFiniteNumber(row.count) }];
  });
}

function parsePage<T>(value: unknown): PaginatedResult<T> {
  const row = asRecord(value);
  const items = Array.isArray(row.items) ? (row.items as T[]) : [];
  const total = Math.max(0, asFiniteNumber(row.total));
  const offset = Math.max(0, asFiniteNumber(row.offset));
  const limit = Math.max(1, asFiniteNumber(row.limit, items.length || 1));
  return {
    items,
    total,
    offset,
    limit,
    hasMore: offset + items.length < total,
  };
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
  const pageSize = 500;
  const imports: RekordboxImport[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('rekordbox_imports')
      .select('*')
      .eq('user_id', userId)
      .order('imported_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as RekordboxImport[];
    imports.push(...page);
    if (page.length < pageSize) break;
  }

  return imports;
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
  const { data, error } = await supabase.rpc('get_rekordbox_playlists_with_counts', {
    p_import_id: importId,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as PlaylistWithCount[];
}

export async function fetchPlaylistTracksPage(
  playlistId: string,
  offset = 0,
  limit = PLAYLIST_TRACK_PAGE_SIZE,
): Promise<PaginatedResult<PlaylistTrackItem>> {
  const { data, error } = await supabase.rpc('get_rekordbox_playlist_track_page', {
    p_playlist_id: playlistId,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return parsePage<PlaylistTrackItem>(data);
}

export async function fetchLibraryTracksPage(
  importId: string,
  offset = 0,
  limit = LIBRARY_TRACK_PAGE_SIZE,
  filters: LibraryTrackFilters = {},
): Promise<PaginatedResult<RekordboxTrack>> {
  const { data, error } = await supabase.rpc('get_rekordbox_library_track_page', {
    p_import_id: importId,
    p_offset: offset,
    p_limit: limit,
    p_search: filters.search?.trim() || null,
    p_genre: filters.genre?.trim() || null,
    p_artist: filters.artist?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return parsePage<RekordboxTrack>(data);
}


export async function fetchTracksByIds(trackIds: string[]): Promise<RekordboxTrack[]> {
  const uniqueIds = [...new Set(trackIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const chunkSize = 200;
  const byId = new Map<string, RekordboxTrack>();
  for (let start = 0; start < uniqueIds.length; start += chunkSize) {
    const chunk = uniqueIds.slice(start, start + chunkSize);
    const { data, error } = await supabase
      .from('rekordbox_tracks')
      .select('*')
      .in('id', chunk);

    if (error) throw new Error(error.message);
    for (const track of (data ?? []) as RekordboxTrack[]) {
      byId.set(track.id, track);
    }
  }

  return uniqueIds.flatMap((id) => {
    const track = byId.get(id);
    return track ? [track] : [];
  });
}

export async function fetchPlaylistById(playlistId: string): Promise<PlaylistWithCount | null> {
  const { data, error } = await supabase
    .from('rekordbox_playlists')
    .select('*')
    .eq('id', playlistId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...(data as RekordboxPlaylist), track_count: 0 };
}

export async function fetchImportById(importId: string): Promise<RekordboxImport | null> {
  const { data, error } = await supabase
    .from('rekordbox_imports')
    .select('*')
    .eq('id', importId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as RekordboxImport | null;
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

export async function fetchLibraryStats(importId: string): Promise<LibraryStats> {
  const { data, error } = await supabase.rpc('get_rekordbox_library_stats', {
    p_import_id: importId,
  });
  if (error) throw new Error(error.message);
  const row = asRecord(data);
  const averageBpm = row.average_bpm == null ? null : asFiniteNumber(row.average_bpm, Number.NaN);
  const mostCommonBpm = row.most_common_bpm == null
    ? null
    : asFiniteNumber(row.most_common_bpm, Number.NaN);

  return {
    totalTrackCount: asFiniteNumber(row.total_track_count),
    totalDurationSeconds: asFiniteNumber(row.total_duration_seconds),
    averageBpm: averageBpm != null && Number.isFinite(averageBpm) ? averageBpm : null,
    mostCommonBpm: mostCommonBpm != null && Number.isFinite(mostCommonBpm) ? mostCommonBpm : null,
    mostCommonKey: typeof row.most_common_key === 'string' ? row.most_common_key : null,
    genreTotals: parseNamedTotals(row.genre_totals),
    artistTotals: parseNamedTotals(row.artist_totals),
    bpmTotals: parseBpmTotals(row.bpm_totals),
    keyTotals: parseNamedTotals(row.key_totals),
  };
}

export async function fetchPlaylistStats(playlistId: string): Promise<PlaylistStats> {
  const { data, error } = await supabase.rpc('get_rekordbox_playlist_stats', {
    p_playlist_id: playlistId,
  });
  if (error) throw new Error(error.message);
  const row = asRecord(data);
  const averageBpm = row.average_bpm == null ? null : asFiniteNumber(row.average_bpm, Number.NaN);

  return {
    trackCount: asFiniteNumber(row.track_count),
    totalDurationSeconds: asFiniteNumber(row.total_duration_seconds),
    averageBpm: averageBpm != null && Number.isFinite(averageBpm) ? averageBpm : null,
    mostCommonKey: typeof row.most_common_key === 'string' ? row.most_common_key : null,
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
  const { data, error } = await supabase.rpc('get_rekordbox_track_playlists', {
    p_import_id: importId,
    p_track_id: trackId,
  });

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];

  return data.flatMap((entry) => {
    const row = asRecord(entry);
    const playlist = asRecord(row.playlist);
    if (typeof playlist.id !== 'string' || typeof playlist.name !== 'string') return [];
    return [{
      position: asFiniteNumber(row.position),
      playlist: playlist as unknown as RekordboxPlaylist,
    }];
  });
}

/**
 * Fetch the best database candidates that are Camelot-compatible and/or within
 * BPM tolerance. Candidate unioning and deterministic pre-ranking happen in
 * Postgres before the limit is applied, so an arbitrary table slice cannot hide
 * a stronger match from the TypeScript scoring pipeline.
 */
export async function fetchCamelotCompatibleTracks(
  importId: string,
  track: Pick<RekordboxTrack, 'id' | 'camelot_key' | 'bpm'>
    & Partial<Pick<RekordboxTrack, 'genre' | 'label'>>,
  bpmTolerance = BPM_TOLERANCE_DEFAULT,
  limit = SIMILAR_CANDIDATE_FETCH_LIMIT,
): Promise<RekordboxTrack[]> {
  const { camelot_key, bpm: rawBpm, id } = track;

  if (!hasSimilarVibesSignal(camelot_key, rawBpm)) return [];

  const compatibleCamelotKeys = getCompatibleCamelotKeys(camelot_key).map((key) => key.code);
  const { data, error } = await supabase.rpc('get_rekordbox_similar_vibe_candidates', {
    p_import_id: importId,
    p_selected_track_id: id,
    p_compatible_camelot_keys: compatibleCamelotKeys,
    p_selected_bpm: shouldUseBpm(rawBpm) ? rawBpm : null,
    p_bpm_tolerance: Math.max(0, bpmTolerance),
    p_selected_genre: track.genre?.trim() || null,
    p_selected_label: track.label?.trim() || null,
    p_limit: Math.max(1, limit),
  });

  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as RekordboxTrack[];
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
