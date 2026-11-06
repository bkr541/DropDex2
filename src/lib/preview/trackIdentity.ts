import type { RekordboxTrack } from '../../types';

type IdentityFields = Pick<RekordboxTrack, 'rekordbox_content_id' | 'title' | 'artist' | 'file_path' | 'duration_seconds'> & {
  master_db_id?: string | null;
  master_content_id?: string | null;
};

const clean = (value: string | null | undefined) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The same track across imports, in the order the library rescan trusts: Rekordbox's own master ids first, then the content id,
 * and only then a fallback built from the path, title, artist and length.
 */
export function trackIdentityKey(track: IdentityFields): string {
  if (track.master_db_id && track.master_content_id) return `m:${track.master_db_id}:${track.master_content_id}`;
  if (track.rekordbox_content_id) return `c:${track.rekordbox_content_id}`;
  return `p:${clean(track.file_path)}|${clean(track.title)}|${clean(track.artist)}|${track.duration_seconds ?? ''}`;
}

/** `{user id}/{32 hex characters}.m4a`. The first folder is the user's id, which is what the storage rules check. */
export async function previewStoragePath(userId: string, identityKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identityKey));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${userId}/${hex}.m4a`;
}
