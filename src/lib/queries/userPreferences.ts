import { supabase } from '../supabase';
import type { UserArtistPreference, UserGenrePreference } from '../../types';

// ── Artist preferences (max 10) ───────────────────────────────────────────────

export async function fetchUserArtists(userId: string): Promise<UserArtistPreference[]> {
  const { data, error } = await supabase
    .from('user_artists')
    .select('user_id, artist_id, position, created_at, artist:artists(id, name, normalized_name, profile_image_url)')
    .eq('user_id', userId)
    .order('position');

  if (error) throw error;
  return (data ?? []) as unknown as UserArtistPreference[];
}

export async function upsertUserArtist(
  userId: string,
  artistId: string,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from('user_artists')
    .upsert({ user_id: userId, artist_id: artistId, position }, { onConflict: 'user_id,artist_id' });

  if (error) throw error;
}

export async function deleteUserArtist(userId: string, artistId: string): Promise<void> {
  const { error } = await supabase
    .from('user_artists')
    .delete()
    .eq('user_id', userId)
    .eq('artist_id', artistId);

  if (error) throw error;
}

// ── Genre preferences (max 5) ─────────────────────────────────────────────────

export async function fetchUserGenres(userId: string): Promise<UserGenrePreference[]> {
  const { data, error } = await supabase
    .from('user_genres')
    .select('user_id, genre_id, position, created_at, genre:genres(id, name, normalized_name)')
    .eq('user_id', userId)
    .order('position');

  if (error) throw error;
  return (data ?? []) as unknown as UserGenrePreference[];
}

export async function upsertUserGenre(
  userId: string,
  genreId: string,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from('user_genres')
    .upsert({ user_id: userId, genre_id: genreId, position }, { onConflict: 'user_id,genre_id' });

  if (error) throw error;
}

export async function deleteUserGenre(userId: string, genreId: string): Promise<void> {
  const { error } = await supabase
    .from('user_genres')
    .delete()
    .eq('user_id', userId)
    .eq('genre_id', genreId);

  if (error) throw error;
}
