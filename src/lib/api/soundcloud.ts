import { IMPORT_API_BASE } from './baseUrl';
import { expectStringArray } from './responseValidation';

export async function fetchIlleniumTrackTitles(
  accessToken: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`${IMPORT_API_BASE}/api/discovery/soundcloud/illenium/tracks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === 'string'
      ? body.detail
      : `SoundCloud search failed (HTTP ${response.status})`);
  }
  return expectStringArray(await response.json(), 'SoundCloud track titles', '$');
}
