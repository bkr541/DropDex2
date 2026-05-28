/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RekordboxImport {
  id: string;
  user_id: string;
  source_filename: string;
  source_type: string;
  database_version: string | null;
  device_name: string | null;
  rekordbox_created_date: string | null;
  track_count: number;
  playlist_count: number;
  playlist_track_count: number;
  status: 'processing' | 'completed' | 'failed';
  error_message: string | null;
  imported_at: string;
}

export interface RekordboxTrack {
  id: string;
  import_id: string;
  rekordbox_content_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  remixer: string | null;
  genre: string | null;
  label: string | null;
  musical_key: string | null;
  bpm: number | null;
  duration_seconds: number | null;
  rating: number | null;
  comments: string | null;
  file_path: string | null;
  file_format: string | null;
  date_added: string | null;
  created_at: string;
}

export interface RekordboxPlaylist {
  id: string;
  import_id: string;
  rekordbox_playlist_id: string;
  name: string;
  parent_playlist_id: string | null;
  sort_order: number | null;
  is_folder: boolean;
  created_at: string;
}

export interface RekordboxPlaylistTrack {
  playlist_id: string;
  track_id: string;
  position: number;
  created_at: string;
}

export interface RekordboxUserSettings {
  user_id: string;
  active_import_id: string | null;
  updated_at: string;
}

// ── Discovery types ───────────────────────────────────────────────────────────

export interface DiscoveryArtist {
  id: string;
  name: string;
  normalized_name: string | null;
  matched_alias: string | null;
  profile_image_url: string | null;
}

export interface DiscoveryListenSource {
  name: string;
  url: string;
}

export interface DiscoverySetlistResult {
  id: string;
  source_tracklist_id: string | null;
  source_url: string | null;
  title: string | null;
  artwork_url: string | null;
  set_date: string | null;
  ided_tracks: number | null;
  total_tracks: number | null;
  completion_pct: number | null;
  duration_text: string | null;
  duration_seconds: number | null;
  music_styles: string[] | null;
  listen_sources: DiscoveryListenSource[] | null;
  views: number | null;
  likes: number | null;
  creator_username: string | null;
  creator_profile_url: string | null;
  updated_at: string | null;
}

export type DiscoveryScrapeStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DiscoveryScrapeJob {
  job_id: string;
  artist_id: string;
  artist_name: string | null;
  source: string;
  status: DiscoveryScrapeStatus;
  pages_scraped: number;
  results_found: number;
  total_results_reported: number | null;
  error_message: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DiscoverySetlistsPage {
  artist_id: string;
  total: number;
  limit: number;
  offset: number;
  results: DiscoverySetlistResult[];
}

export interface ScrapeStartResponse {
  job_id: string;
  artist_id: string;
  artist_name: string;
  status: string;
}

export interface SearchArtist {
  id: string;
  name: string;
  normalized_name: string | null;
  source_artist_url: string | null;
  genres: string[];
}

// ── Set-detail (individual track rows) types ──────────────────────────────────

export interface DiscoverySetTrack {
  id: string;
  set_result_id: string;
  source: string;
  source_position_id: string;
  source_track_id: string | null;
  sequence_index: number;
  track_number: number | null;
  played_with_previous: boolean;
  cue_seconds: number | null;
  cue_text: string | null;
  title: string | null;
  artist_text: string | null;
  label_text: string | null;
  duration_seconds: number | null;
  duration_text: string | null;
  source_track_url: string | null;
  artwork_url: string | null;
}

export interface DiscoverySetlistDetailSummary {
  id: string;
  title: string;
  source_url: string;
  set_date: string | null;
  artwork_url: string | null;
  duration_seconds: number | null;
  track_count: number | null;
  parsed_track_count: number | null;
  detail_scrape_status: 'not_scraped' | 'queued' | 'running' | 'completed' | 'failed';
  detail_scraped_at: string | null;
  detail_scrape_error: string | null;
  has_timed_cues: boolean | null;
}

export interface DiscoverySetTracklistDetail {
  setlist: DiscoverySetlistDetailSummary;
  tracks: DiscoverySetTrack[];
}
