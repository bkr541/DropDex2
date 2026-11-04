import { supabase } from '../supabase';
import type { CatalogGenre, GenreBrowseArtist } from '../../types';

/** Every genre that at least one artist in the catalog is tagged with, with how many artists that is. */
export async function fetchCatalogGenres(): Promise<CatalogGenre[]> {
  const { data, error } = await supabase
    .from('genres')
    .select('id, name, artist_genres(count)');
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as { id: number | string; name: string; artist_genres: { count: number }[] | null }[])
    .map((row) => ({
      id: String(row.id),
      name: row.name,
      artistCount: row.artist_genres?.[0]?.count ?? 0,
    }))
    .filter((genre) => genre.artistCount > 0);
}

/** The catalog artists tagged with one genre, A to Z. */
export async function fetchArtistsInGenre(genreId: string): Promise<GenreBrowseArtist[]> {
  const { data, error } = await supabase
    .from('artists')
    .select('id, name, normalized_name, profile_image_url, artist_genres!inner(genre_id)')
    .eq('artist_genres.genre_id', genreId)
    .order('name')
    .limit(1000);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as { id: number | string; name: string; normalized_name: string | null; profile_image_url: string | null }[])
    .map((row) => ({
      id: String(row.id),
      name: row.name,
      normalized_name: row.normalized_name ?? null,
      profile_image_url: row.profile_image_url ?? null,
    }));
}
