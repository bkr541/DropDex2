import type {
  DiscoveryArtist,
  DiscoveryScrapeJob,
  DiscoverySetlistsPage,
  ScrapeStartResponse,
} from '../../types';

const API_BASE = (import.meta.env.VITE_IMPORT_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  return body?.detail ?? `Request failed (HTTP ${response.status})`;
}

export async function searchDiscoveryArtists(
  query: string,
  accessToken: string,
): Promise<DiscoveryArtist[]> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/search?q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<DiscoveryArtist[]>;
}

export async function startArtistSetlistScrape(
  artistId: string,
  accessToken: string,
): Promise<ScrapeStartResponse> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/${encodeURIComponent(artistId)}/setlists/scrape`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<ScrapeStartResponse>;
}

export async function fetchDiscoveryScrapeJob(
  jobId: string,
  accessToken: string,
): Promise<DiscoveryScrapeJob> {
  const response = await fetch(
    `${API_BASE}/api/discovery/scrape-jobs/${encodeURIComponent(jobId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<DiscoveryScrapeJob>;
}

export async function fetchArtistSetlists(
  artistId: string,
  accessToken: string,
  limit = 20,
  offset = 0,
): Promise<DiscoverySetlistsPage> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/${encodeURIComponent(artistId)}/setlists?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<DiscoverySetlistsPage>;
}
