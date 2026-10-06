import { IMPORT_API_BASE } from './baseUrl';
import {
  ApiResponseValidationError,
  expectArray,
  expectBoolean,
  expectNullableString,
  expectNumber,
  expectRecord,
  expectString,
} from './responseValidation';

export type ExternalAccountState = 'pending' | 'linked' | 'failed';

export interface SpotifyAccountStatus {
  provider: 'spotify';
  status: ExternalAccountState;
  display_name: string | null;
  profile_url: string | null;
  linked_at: string | null;
  playlist_access: boolean;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  external_url: string | null;
  owner_name: string | null;
  item_count: number;
  collaborative: boolean;
  public: boolean | null;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album_name: string | null;
  image_url: string | null;
  duration_ms: number;
  explicit: boolean;
  external_url: string | null;
  added_at: string | null;
}

export interface SpotifyPlaylistPage {
  items: SpotifyPlaylist[];
  total: number;
  limit: number;
  offset: number;
}

export interface SpotifyTrackPage {
  playlist_id: string;
  items: SpotifyTrack[];
  total: number;
  limit: number;
  offset: number;
}

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null;
  return typeof body?.detail === 'string'
    ? body.detail
    : `Request failed (HTTP ${response.status})`;
}

function validateStatus(value: unknown): SpotifyAccountStatus {
  const contract = 'Spotify account status';
  const row = expectRecord(value, contract);
  const provider = expectString(row.provider, contract, '$.provider');
  const status = expectString(row.status, contract, '$.status');
  if (provider !== 'spotify') {
    throw new ApiResponseValidationError(contract, '$.provider', 'spotify');
  }
  if (!['pending', 'linked', 'failed'].includes(status)) {
    throw new ApiResponseValidationError(contract, '$.status', 'pending, linked, or failed');
  }
  return {
    provider,
    status: status as ExternalAccountState,
    display_name: expectNullableString(row.display_name, contract, '$.display_name'),
    profile_url: expectNullableString(row.profile_url, contract, '$.profile_url'),
    linked_at: expectNullableString(row.linked_at, contract, '$.linked_at'),
    playlist_access: expectBoolean(row.playlist_access, contract, '$.playlist_access'),
  };
}

function validatePlaylist(value: unknown, path: string): SpotifyPlaylist {
  const contract = 'Spotify playlists';
  const row = expectRecord(value, contract, path);
  const publicValue = row.public;
  if (publicValue !== null && typeof publicValue !== 'boolean') {
    throw new ApiResponseValidationError(contract, `${path}.public`, 'a boolean or null');
  }
  return {
    id: expectString(row.id, contract, `${path}.id`),
    name: expectString(row.name, contract, `${path}.name`),
    description: expectNullableString(row.description, contract, `${path}.description`),
    image_url: expectNullableString(row.image_url, contract, `${path}.image_url`),
    external_url: expectNullableString(row.external_url, contract, `${path}.external_url`),
    owner_name: expectNullableString(row.owner_name, contract, `${path}.owner_name`),
    item_count: expectNumber(row.item_count, contract, `${path}.item_count`),
    collaborative: expectBoolean(row.collaborative, contract, `${path}.collaborative`),
    public: publicValue,
  };
}

function validateTrack(value: unknown, path: string): SpotifyTrack {
  const contract = 'Spotify playlist tracks';
  const row = expectRecord(value, contract, path);
  return {
    id: expectString(row.id, contract, `${path}.id`),
    name: expectString(row.name, contract, `${path}.name`),
    artists: expectArray(row.artists, contract, `${path}.artists`).map((artist, index) =>
      expectString(artist, contract, `${path}.artists[${index}]`)),
    album_name: expectNullableString(row.album_name, contract, `${path}.album_name`),
    image_url: expectNullableString(row.image_url, contract, `${path}.image_url`),
    duration_ms: expectNumber(row.duration_ms, contract, `${path}.duration_ms`),
    explicit: expectBoolean(row.explicit, contract, `${path}.explicit`),
    external_url: expectNullableString(row.external_url, contract, `${path}.external_url`),
    added_at: expectNullableString(row.added_at, contract, `${path}.added_at`),
  };
}

function validatePlaylistPage(value: unknown): SpotifyPlaylistPage {
  const contract = 'Spotify playlists';
  const row = expectRecord(value, contract);
  return {
    items: expectArray(row.items, contract, '$.items').map((item, index) =>
      validatePlaylist(item, `$.items[${index}]`)),
    total: expectNumber(row.total, contract, '$.total'),
    limit: expectNumber(row.limit, contract, '$.limit'),
    offset: expectNumber(row.offset, contract, '$.offset'),
  };
}

function validateTrackPage(value: unknown): SpotifyTrackPage {
  const contract = 'Spotify playlist tracks';
  const row = expectRecord(value, contract);
  return {
    playlist_id: expectString(row.playlist_id, contract, '$.playlist_id'),
    items: expectArray(row.items, contract, '$.items').map((item, index) =>
      validateTrack(item, `$.items[${index}]`)),
    total: expectNumber(row.total, contract, '$.total'),
    limit: expectNumber(row.limit, contract, '$.limit'),
    offset: expectNumber(row.offset, contract, '$.offset'),
  };
}

export async function fetchSpotifyAccountStatus(
  accessToken: string,
  signal?: AbortSignal,
): Promise<SpotifyAccountStatus> {
  const response = await fetch(`${IMPORT_API_BASE}/api/external-accounts/spotify`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(await parseError(response));
  return validateStatus(await response.json());
}

export async function beginSpotifyAccountLink(
  accessToken: string,
): Promise<string> {
  const response = await fetch(`${IMPORT_API_BASE}/api/external-accounts/spotify/connect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(await parseError(response));
  const row = expectRecord(await response.json(), 'Spotify authorization');
  return expectString(row.authorization_url, 'Spotify authorization', '$.authorization_url');
}

export async function unlinkSpotifyAccount(accessToken: string): Promise<void> {
  const response = await fetch(`${IMPORT_API_BASE}/api/external-accounts/spotify`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function fetchSpotifyPlaylists(
  accessToken: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<SpotifyPlaylistPage> {
  const params = new URLSearchParams({ limit: '50', offset: String(offset) });
  const response = await fetch(
    `${IMPORT_API_BASE}/api/external-accounts/spotify/playlists?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return validatePlaylistPage(await response.json());
}

export async function fetchSpotifyPlaylistTracks(
  accessToken: string,
  playlistId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<SpotifyTrackPage> {
  const params = new URLSearchParams({ limit: '50', offset: String(offset) });
  const response = await fetch(
    `${IMPORT_API_BASE}/api/external-accounts/spotify/playlists/${encodeURIComponent(playlistId)}/tracks?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error(await parseError(response));
  return validateTrackPage(await response.json());
}
