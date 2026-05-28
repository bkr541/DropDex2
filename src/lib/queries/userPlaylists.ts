import { supabase } from '../supabase';
import type { UserPlaylistProfile } from '../../types';

/**
 * Build the stable playlist identity key used in user_playlist_profiles.
 *
 * Format: "<device_name>::<rekordbox_playlist_id>"
 *
 * rekordbox_playlist_id is Rekordbox's own internal numeric ID — stable for a
 * given playlist across rescans within the same library, but sequential-from-1
 * so it collides across different Rekordbox installations.  Prefixing with
 * device_name (from rekordbox_imports) makes the key unique per device.
 *
 * Source columns: rekordbox_imports.device_name + rekordbox_playlists.rekordbox_playlist_id
 */
export function buildPlaylistIdentityKey(
  deviceName: string,
  rekordboxPlaylistId: string,
): string {
  return `${deviceName}::${rekordboxPlaylistId}`;
}

export async function fetchPlaylistProfile(
  userId: string,
  identityKey: string,
): Promise<UserPlaylistProfile | null> {
  const { data, error } = await supabase
    .from('user_playlist_profiles')
    .select('*')
    .eq('user_id', userId)
    .eq('playlist_identity_key', identityKey)
    .maybeSingle();

  if (error) throw error;
  return data as UserPlaylistProfile | null;
}

export async function fetchAllPlaylistProfiles(
  userId: string,
): Promise<UserPlaylistProfile[]> {
  const { data, error } = await supabase
    .from('user_playlist_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');

  if (error) throw error;
  return (data ?? []) as UserPlaylistProfile[];
}

export async function upsertPlaylistProfile(
  userId: string,
  identityKey: string,
  updates: Partial<Pick<UserPlaylistProfile, 'display_name' | 'description' | 'artwork_url'>>,
): Promise<UserPlaylistProfile> {
  const { data, error } = await supabase
    .from('user_playlist_profiles')
    .upsert(
      { user_id: userId, playlist_identity_key: identityKey, ...updates },
      { onConflict: 'user_id,playlist_identity_key' },
    )
    .select()
    .single();

  if (error) throw error;
  return data as UserPlaylistProfile;
}
