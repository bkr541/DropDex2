import { supabase } from '../supabase';
import type { UserPlaylistProfile } from '../../types';

/**
 * Build the stable playlist identity key used in user_playlist_profiles.
 *
 * Format: "<usb id>::<rekordbox_playlist_id>"
 *
 * rekordbox_playlist_id is Rekordbox's own internal numeric ID: stable for a given playlist across rescans of the same
 * library, but numbered from 1 on every installation, so it collides across USBs. Each USB has its own id
 * (user_usb_devices.id), so the key stays unique even when two USBs share a name.
 */
export function buildPlaylistIdentityKey(
  usbOwner: string,
  rekordboxPlaylistId: string,
): string {
  return `${usbOwner}::${rekordboxPlaylistId}`;
}

/**
 * Who a snapshot's playlist customisations belong to: its USB's id. Snapshots without one (imported before USBs had ids,
 * or when the drive could not be identified) fall back to the drive name, which is what their keys used before.
 */
export function playlistKeyOwner(snapshot: { usb_device_id?: string | null; device_name: string | null }): string {
  return snapshot.usb_device_id ?? snapshot.device_name ?? '';
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
