import { supabase } from '../supabase';
import type { RekordboxImport, RekordboxTrack, RekordboxPlaylist, RekordboxUserSettings } from '../../types';

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

  const { data: ptRows, error: ptErr } = await supabase
    .from('rekordbox_playlist_tracks')
    .select('playlist_id')
    .in('playlist_id', playlistIds);

  if (ptErr) throw new Error(ptErr.message);

  const countMap: Record<string, number> = {};
  for (const row of ptRows ?? []) {
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

export async function fetchSimilarTracks(
  importId: string,
  bpm: number | null,
  key: string | null,
  excludeId: string,
): Promise<RekordboxTrack[]> {
  if (!bpm && !key) return [];

  let query = supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .neq('id', excludeId);

  if (key) {
    query = query.eq('musical_key', key);
  } else if (bpm) {
    query = query.gte('bpm', bpm - 2).lte('bpm', bpm + 2);
  }

  const { data, error } = await query.limit(3);
  if (error) throw new Error(error.message);
  return (data ?? []) as RekordboxTrack[];
}
