import { IMPORT_API_BASE } from './baseUrl';
import {
  ApiResponseValidationError,
  expectArray,
  expectBoolean,
  expectNullableNumber,
  expectNullableString,
  expectNumber,
  expectOptionalBoolean,
  expectRecord,
  expectString,
  expectStringArray,
} from './responseValidation';
import type {
  DiscoveryArtist,
  DiscoveryArtistDetail,
  DiscoveryScrapeJob,
  DiscoverySetlistsPage,
  DiscoverySetTracklistDetail,
  ScrapeStartResponse,
} from '../../types';

const API_BASE = IMPORT_API_BASE;

type Validator<T> = (value: unknown) => T;

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null;
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    if (typeof record.detail === 'string') return record.detail;
    if (typeof record.message === 'string') return record.message;
  }
  return `Request failed (HTTP ${response.status})`;
}

async function parseValidated<T>(
  response: Response,
  validator: Validator<T>,
): Promise<T> {
  if (!response.ok) throw new Error(await parseError(response));
  const body = await response.json().catch(() => {
    throw new ApiResponseValidationError('discovery API', '$', 'valid JSON');
  });
  return validator(body);
}

function validateArtist(value: unknown, path: string): DiscoveryArtist {
  const contract = 'artist search';
  const row = expectRecord(value, contract, path);
  expectString(row.id, contract, `${path}.id`);
  expectString(row.name, contract, `${path}.name`);
  expectNullableString(row.normalized_name, contract, `${path}.normalized_name`);
  expectNullableString(row.matched_alias, contract, `${path}.matched_alias`);
  expectNullableString(row.profile_image_url, contract, `${path}.profile_image_url`);
  return row as unknown as DiscoveryArtist;
}

function validateArtistSearch(value: unknown): DiscoveryArtist[] {
  return expectArray(value, 'artist search', '$').map((row, index) =>
    validateArtist(row, `$[${index}]`));
}

function validateArtistDetail(value: unknown): DiscoveryArtistDetail {
  const contract = 'artist detail';
  const row = expectRecord(value, contract);
  expectString(row.id, contract, '$.id');
  expectString(row.name, contract, '$.name');
  expectNullableString(row.normalized_name, contract, '$.normalized_name');
  expectStringArray(row.aliases, contract, '$.aliases');
  expectNullableString(row.source, contract, '$.source');
  expectNullableString(row.source_artist_url, contract, '$.source_artist_url');
  expectNullableString(row.profile_image_url, contract, '$.profile_image_url');
  expectNumber(row.stored_setlist_count, contract, '$.stored_setlist_count');
  expectNumber(row.stored_track_count, contract, '$.stored_track_count');
  expectNullableString(row.created_at, contract, '$.created_at');
  expectNullableString(row.updated_at, contract, '$.updated_at');
  expectArray(row.genres, contract, '$.genres').forEach((genre, index) => {
    const genreRow = expectRecord(genre, contract, `$.genres[${index}]`);
    expectString(genreRow.id, contract, `$.genres[${index}].id`);
    expectString(genreRow.name, contract, `$.genres[${index}].name`);
  });
  return row as unknown as DiscoveryArtistDetail;
}

function validateScrapeStart(value: unknown): ScrapeStartResponse {
  const contract = 'scrape start';
  const row = expectRecord(value, contract);
  expectString(row.job_id, contract, '$.job_id');
  expectString(row.artist_id, contract, '$.artist_id');
  expectString(row.artist_name, contract, '$.artist_name');
  expectString(row.status, contract, '$.status');
  expectOptionalBoolean(row.reused, contract, '$.reused');
  return row as unknown as ScrapeStartResponse;
}

function validateScrapeJob(value: unknown): DiscoveryScrapeJob {
  const contract = 'scrape job';
  const row = expectRecord(value, contract);
  expectString(row.job_id, contract, '$.job_id');
  expectString(row.artist_id, contract, '$.artist_id');
  expectNullableString(row.artist_name, contract, '$.artist_name');
  expectString(row.source, contract, '$.source');
  const status = expectString(row.status, contract, '$.status');
  if (!['queued', 'running', 'completed', 'failed'].includes(status)) {
    throw new ApiResponseValidationError(contract, '$.status', 'a known scrape status');
  }
  expectNumber(row.pages_scraped, contract, '$.pages_scraped');
  expectNumber(row.results_found, contract, '$.results_found');
  expectNullableNumber(row.total_results_reported, contract, '$.total_results_reported');
  expectNullableString(row.error_message, contract, '$.error_message');
  expectNullableString(row.created_at, contract, '$.created_at');
  expectNullableString(row.started_at, contract, '$.started_at');
  expectNullableString(row.completed_at, contract, '$.completed_at');
  return row as unknown as DiscoveryScrapeJob;
}

function validateSetlistResult(value: unknown, path: string) {
  const contract = 'setlist page';
  const row = expectRecord(value, contract, path);
  expectString(row.id, contract, `${path}.id`);
  expectNullableString(row.source_tracklist_id, contract, `${path}.source_tracklist_id`);
  expectNullableString(row.source_url, contract, `${path}.source_url`);
  expectNullableString(row.title, contract, `${path}.title`);
  expectNullableString(row.artwork_url, contract, `${path}.artwork_url`);
  expectNullableString(row.set_date, contract, `${path}.set_date`);
  expectNullableNumber(row.ided_tracks, contract, `${path}.ided_tracks`);
  expectNullableNumber(row.total_tracks, contract, `${path}.total_tracks`);
  expectNullableNumber(row.completion_pct, contract, `${path}.completion_pct`);
  expectNullableString(row.duration_text, contract, `${path}.duration_text`);
  expectNullableNumber(row.duration_seconds, contract, `${path}.duration_seconds`);
  if (row.music_styles !== null) expectStringArray(row.music_styles, contract, `${path}.music_styles`);
  expectNullableNumber(row.views, contract, `${path}.views`);
  expectNullableNumber(row.likes, contract, `${path}.likes`);
  expectNullableString(row.creator_username, contract, `${path}.creator_username`);
  expectNullableString(row.creator_profile_url, contract, `${path}.creator_profile_url`);
  expectNullableString(row.updated_at, contract, `${path}.updated_at`);
  if (row.listen_sources !== null) {
    expectArray(row.listen_sources, contract, `${path}.listen_sources`).forEach((source, index) => {
      const sourceRow = expectRecord(source, contract, `${path}.listen_sources[${index}]`);
      expectString(sourceRow.name, contract, `${path}.listen_sources[${index}].name`);
      expectString(sourceRow.url, contract, `${path}.listen_sources[${index}].url`);
    });
  }
  return row;
}

function validateSetlistsPage(value: unknown): DiscoverySetlistsPage {
  const contract = 'setlist page';
  const row = expectRecord(value, contract);
  expectString(row.artist_id, contract, '$.artist_id');
  expectNumber(row.total, contract, '$.total');
  expectNumber(row.limit, contract, '$.limit');
  expectNumber(row.offset, contract, '$.offset');
  expectArray(row.results, contract, '$.results').forEach((result, index) =>
    validateSetlistResult(result, `$.results[${index}]`));
  return row as unknown as DiscoverySetlistsPage;
}

function validateSetTracklistDetail(value: unknown): DiscoverySetTracklistDetail {
  const contract = 'setlist track detail';
  const row = expectRecord(value, contract);
  const setlist = expectRecord(row.setlist, contract, '$.setlist');
  expectString(setlist.id, contract, '$.setlist.id');
  expectString(setlist.title, contract, '$.setlist.title');
  expectString(setlist.source_url, contract, '$.setlist.source_url');
  expectNullableString(setlist.set_date, contract, '$.setlist.set_date');
  expectNullableString(setlist.artwork_url, contract, '$.setlist.artwork_url');
  expectNullableNumber(setlist.duration_seconds, contract, '$.setlist.duration_seconds');
  expectNullableNumber(setlist.track_count, contract, '$.setlist.track_count');
  expectNullableNumber(setlist.parsed_track_count, contract, '$.setlist.parsed_track_count');
  expectString(setlist.detail_scrape_status, contract, '$.setlist.detail_scrape_status');
  expectNullableString(setlist.detail_scraped_at, contract, '$.setlist.detail_scraped_at');
  expectNullableString(setlist.detail_scrape_error, contract, '$.setlist.detail_scrape_error');
  if (setlist.has_timed_cues !== null) {
    expectBoolean(setlist.has_timed_cues, contract, '$.setlist.has_timed_cues');
  }

  expectArray(row.tracks, contract, '$.tracks').forEach((track, index) => {
    const path = `$.tracks[${index}]`;
    const trackRow = expectRecord(track, contract, path);
    expectString(trackRow.id, contract, `${path}.id`);
    expectString(trackRow.set_result_id, contract, `${path}.set_result_id`);
    expectString(trackRow.source, contract, `${path}.source`);
    expectString(trackRow.source_position_id, contract, `${path}.source_position_id`);
    expectNullableString(trackRow.source_track_id, contract, `${path}.source_track_id`);
    expectNumber(trackRow.sequence_index, contract, `${path}.sequence_index`);
    if (trackRow.track_number !== undefined) {
      expectNullableNumber(trackRow.track_number, contract, `${path}.track_number`);
    }
    expectBoolean(trackRow.played_with_previous, contract, `${path}.played_with_previous`);
    expectNullableNumber(trackRow.cue_seconds, contract, `${path}.cue_seconds`);
    expectNullableString(trackRow.cue_text, contract, `${path}.cue_text`);
    expectNullableString(trackRow.title, contract, `${path}.title`);
    expectNullableString(trackRow.artist_text, contract, `${path}.artist_text`);
    expectNullableString(trackRow.label_text, contract, `${path}.label_text`);
    expectNullableNumber(trackRow.duration_seconds, contract, `${path}.duration_seconds`);
    expectNullableString(trackRow.duration_text, contract, `${path}.duration_text`);
    expectNullableString(trackRow.source_track_url, contract, `${path}.source_track_url`);
    expectNullableString(trackRow.artwork_url, contract, `${path}.artwork_url`);
  });

  return row as unknown as DiscoverySetTracklistDetail;
}

export async function searchDiscoveryArtists(
  query: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscoveryArtist[]> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/search?q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseValidated(response, validateArtistSearch);
}

export async function fetchArtistDetail(
  artistId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscoveryArtistDetail> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/${encodeURIComponent(artistId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseValidated(response, validateArtistDetail);
}

export async function startArtistSetlistScrape(
  artistId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ScrapeStartResponse> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/${encodeURIComponent(artistId)}/setlists/scrape`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    },
  );
  return parseValidated(response, validateScrapeStart);
}

export async function fetchDiscoveryScrapeJob(
  jobId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscoveryScrapeJob> {
  const response = await fetch(
    `${API_BASE}/api/discovery/scrape-jobs/${encodeURIComponent(jobId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseValidated(response, validateScrapeJob);
}

export async function fetchArtistSetlists(
  artistId: string,
  accessToken: string,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<DiscoverySetlistsPage> {
  const response = await fetch(
    `${API_BASE}/api/discovery/artists/${encodeURIComponent(artistId)}/setlists?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseValidated(response, validateSetlistsPage);
}

export async function fetchSetlistTracks(
  setResultId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscoverySetTracklistDetail> {
  const response = await fetch(
    `${API_BASE}/api/discovery/setlists/${encodeURIComponent(setResultId)}/tracks`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseValidated(response, validateSetTracklistDetail);
}

export async function scrapeSetlistTracks(
  setResultId: string,
  accessToken: string,
  refresh = false,
  signal?: AbortSignal,
): Promise<DiscoverySetTracklistDetail> {
  const params = refresh ? '?refresh=true' : '';
  const response = await fetch(
    `${API_BASE}/api/discovery/setlists/${encodeURIComponent(setResultId)}/tracks/scrape${params}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    },
  );
  return parseValidated(response, validateSetTracklistDetail);
}

export async function importSetlistTracksHtml(
  setResultId: string,
  accessToken: string,
  html: string,
  signal?: AbortSignal,
): Promise<DiscoverySetTracklistDetail> {
  const response = await fetch(
    `${API_BASE}/api/discovery/setlists/${encodeURIComponent(setResultId)}/tracks/import-html`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ html }),
      signal,
    },
  );
  return parseValidated(response, validateSetTracklistDetail);
}
