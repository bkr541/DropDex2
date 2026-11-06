import { supabase } from '../supabase';
import type { ArtistGenreLink } from '../discovery/forYou';

type LinkRow = {
  artist_id: number | string;
  genre_id: number | string;
  artist: { id: number | string; name: string; normalized_name: string | null; profile_image_url: string | null } | null;
};

/** The genre ids each of these artists is tagged with. */
export async function fetchGenreIdsForArtists(artistIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (artistIds.length === 0) return result;
  const { data, error } = await supabase
    .from('artist_genres')
    .select('artist_id, genre_id')
    .in('artist_id', artistIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { artist_id: number | string; genre_id: number | string }[]) {
    const key = String(row.artist_id);
    result.set(key, [...(result.get(key) ?? []), String(row.genre_id)]);
  }
  return result;
}

/** Every artist tagged with any of these genres, one row per artist and genre (the database returns at most 1,000 rows). */
export async function fetchArtistsSharingGenres(genreIds: string[]): Promise<ArtistGenreLink[]> {
  if (genreIds.length === 0) return [];
  const { data, error } = await supabase
    .from('artist_genres')
    .select('artist_id, genre_id, artist:artists(id, name, normalized_name, profile_image_url)')
    .in('genre_id', genreIds)
    .limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as LinkRow[])
    .filter((row) => row.artist)
    .map((row) => ({
      artistId: String(row.artist_id),
      genreId: String(row.genre_id),
      artist: {
        id: String(row.artist!.id),
        name: row.artist!.name,
        normalized_name: row.artist!.normalized_name ?? null,
        profile_image_url: row.artist!.profile_image_url ?? null,
      },
    }));
}
