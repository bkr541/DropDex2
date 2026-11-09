import { IMPORT_API_BASE } from './baseUrl';
import { expectArray, expectRecord, expectString, expectStringArray } from './responseValidation';

export interface SoundCloudFavoriteArtist { id: string; name: string }

async function getJson(path: string, accessToken: string, signal: AbortSignal | undefined, fallback: string): Promise<unknown> {
  const response = await fetch(`${IMPORT_API_BASE}/api/discovery/soundcloud/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === 'string' ? body.detail : `${fallback} (HTTP ${response.status})`);
  }
  return response.json();
}

/** The user's top five saved favorite artists, in their saved order. */
export async function fetchSoundCloudFavoriteArtists(accessToken: string, signal?: AbortSignal): Promise<SoundCloudFavoriteArtist[]> {
  const rows = expectArray(await getJson('favorite-artists', accessToken, signal, 'Favorite artists failed to load'), 'SoundCloud favorite artists', '$');
  return rows.map((row, index) => {
    const record = expectRecord(row, 'SoundCloud favorite artists', `$[${index}]`);
    return { id: expectString(record.id, 'SoundCloud favorite artists', `$[${index}].id`), name: expectString(record.name, 'SoundCloud favorite artists', `$[${index}].name`) };
  });
}

/** Up to 20 SoundCloud track titles for one of the user's favorite artists. The server looks the name up itself. */
export async function fetchSoundCloudArtistTrackTitles(accessToken: string, artistId: string, signal?: AbortSignal): Promise<string[]> {
  const json = await getJson(`artists/${encodeURIComponent(artistId)}/tracks`, accessToken, signal, 'SoundCloud search failed');
  return expectStringArray(json, 'SoundCloud track titles', '$');
}
