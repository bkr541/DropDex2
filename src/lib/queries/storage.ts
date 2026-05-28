import { supabase } from '../supabase';

const AVATAR_BUCKET = 'avatars';
const ARTWORK_BUCKET = 'playlist-artwork';

function fileExt(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
}

/**
 * Upload (or replace) the user's avatar.
 * Path: avatars/{userId}/profile-image.<ext>
 * Returns a signed URL valid for 1 hour.
 *
 * The bucket is private; callers must store the URL and refresh it as needed,
 * or re-call this helper when a new signed URL is required.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/profile-image.${fileExt(file)}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) throw uploadError;

  const { data } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 31_536_000);
  if (!data?.signedUrl) throw new Error('Failed to generate signed URL for avatar');
  return data.signedUrl;
}

/**
 * Upload (or replace) playlist artwork for the given playlist identity key.
 * Path: playlist-artwork/{userId}/{sanitised_identity_key}.<ext>
 * Returns a signed URL valid for 1 hour.
 *
 * The identity key is sanitised for filesystem safety before use in the path.
 */
export async function uploadPlaylistArtwork(
  userId: string,
  identityKey: string,
  file: File,
): Promise<string> {
  // Collapse any character that is not alphanumeric, dash, dot, underscore, or colon.
  const safeKey = identityKey.replace(/[^a-zA-Z0-9\-._:]/g, '_');
  const path = `${userId}/${safeKey}.${fileExt(file)}`;

  const { error: uploadError } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) throw uploadError;

  // 1-year expiry so the URL survives normal use between re-uploads
  const { data } = await supabase.storage.from(ARTWORK_BUCKET).createSignedUrl(path, 31_536_000);
  if (!data?.signedUrl) throw new Error('Failed to generate signed URL for playlist artwork');
  return data.signedUrl;
}
