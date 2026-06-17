import { supabase } from '../supabase';
import type { DiscoveryArtistGenre, DiscoverySetlistResult, FeedArtist } from '../../types';

export async function fetchTopArtistsForFeed(limit = 10): Promise<FeedArtist[]> {
  const { data: rows, error } = await supabase.rpc('get_top_artists_for_feed', {
    p_limit: limit,
  });
  if (error) throw error;
  if (!rows?.length) return [];

  const artistIds = (rows as { id: string }[]).map((r) => r.id);

  // Batch-fetch canonical genres for all artists in one round-trip
  const { data: genreLinks, error: gErr } = await supabase
    .from('artist_genres')
    .select('artist_id, genre:genres(id, name)')
    .in('artist_id', artistIds);
  if (gErr) throw gErr;

  const genreMap: Record<string, DiscoveryArtistGenre[]> = {};
  for (const link of (genreLinks ?? [] as unknown[]) as { artist_id: string; genre: { id: number; name: string } | null }[]) {
    if (link.genre) {
      (genreMap[link.artist_id] ??= []).push({
        id: String(link.genre.id),
        name: link.genre.name,
      });
    }
  }

  return (rows as {
    id: string;
    name: string;
    normalized_name: string | null;
    profile_image_url: string | null;
    setlist_count: string | number;
  }[]).map((r) => ({
    id: String(r.id),
    name: r.name,
    normalized_name: r.normalized_name ?? null,
    profile_image_url: r.profile_image_url ?? null,
    setlist_count: Number(r.setlist_count),
    genres: genreMap[r.id] ?? [],
  }));
}

export async function fetchSetlistsForArtistFeed(
  artistId: string,
  limit = 10,
): Promise<DiscoverySetlistResult[]> {
  // Step 1: collect all set_result_ids for this artist via the authoritative junction table.
  // No limit here — we need all IDs so step 2 can pick the most-recent ones.
  const { data: junctionRows, error: jErr } = await supabase
    .from('artist_set_result_artists')
    .select('set_result_id')
    .eq('artist_id', artistId);

  if (jErr) throw jErr;
  if (!junctionRows?.length) return [];

  const ids = junctionRows.map((r) => r.set_result_id as string);

  // Step 2: fetch setlists by those IDs, ordered by most-recent set date.
  const { data, error } = await supabase
    .from('artist_set_results')
    .select(
      `id, source_tracklist_id, source_url, title, artwork_url, set_date,
       ided_tracks, total_tracks, completion_pct, duration_text, duration_seconds,
       music_styles, listen_sources, views, likes, creator_username,
       creator_profile_url, updated_at`,
    )
    .in('id', ids)
    .order('set_date', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    source_tracklist_id: row.source_tracklist_id as string | null,
    source_url: row.source_url as string | null,
    title: row.title as string | null,
    artwork_url: row.artwork_url as string | null,
    set_date: row.set_date as string | null,
    ided_tracks: row.ided_tracks as number | null,
    total_tracks: row.total_tracks as number | null,
    completion_pct: row.completion_pct as number | null,
    duration_text: row.duration_text as string | null,
    duration_seconds: row.duration_seconds as number | null,
    music_styles: row.music_styles as string[] | null,
    listen_sources: row.listen_sources as { name: string; url: string }[] | null,
    views: row.views as number | null,
    likes: row.likes as number | null,
    creator_username: row.creator_username as string | null,
    creator_profile_url: row.creator_profile_url as string | null,
    updated_at: row.updated_at as string | null,
  }));
}
