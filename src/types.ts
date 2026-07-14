/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RekordboxSourceBundleType =
  'database_only' | 'usb_folder' | 'zip_bundle' | 'desktop_bridge';

export type RekordboxAnalysisStatus =
  | 'not_requested'
  | 'awaiting_upload'
  | 'uploading'
  | 'uploaded'
  | 'parsing'
  | 'completed'
  | 'partial'
  | 'failed';

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
  status:
    | 'created'
    | 'uploading'
    | 'queued'
    | 'processing'
    | 'cancel_requested'
    | 'cancelled'
    | 'completed'
    | 'failed';
  error_message: string | null;
  error_code?: string | null;
  retryable?: boolean;
  updated_at?: string;
  imported_at: string;
  // Analysis pipeline fields (null until analysis is initiated)
  source_bundle_type: RekordboxSourceBundleType | null;
  analysis_status: RekordboxAnalysisStatus | null;
  analysis_expected_track_count: number;
  analysis_matched_track_count: number;
  analysis_parsed_track_count: number;
  analysis_failed_track_count: number;
  analysis_asset_count: number;
  analysis_parser_version: string | null;
  analysis_completed_at: string | null;
  analysis_warnings: unknown[];
}

export type RekordboxTrackParseStatus =
  | 'not_requested'
  | 'queued'
  | 'parsing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'reused';

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
  camelot_key: string | null;
  normalized_key_name: string | null;
  key_tonic: string | null;
  key_mode: 'major' | 'minor' | null;
  bpm: number | null;
  duration_seconds: number | null;
  duration_ms?: number | null;
  rating: number | null;
  comments: string | null;
  file_path: string | null;
  file_path_normalized?: string | null;
  file_path_volume?: string | null;
  file_path_casefold?: string | null;
  file_name?: string | null;
  file_format: string | null;
  file_type_code?: number | null;
  file_extension?: string | null;
  file_size_bytes?: number | null;
  bitrate_kbps?: number | null;
  bit_depth?: number | null;
  sample_rate_hz?: number | null;
  date_added: string | null;
  source_title?: string | null;
  subtitle?: string | null;
  original_artist?: string | null;
  composer?: string | null;
  lyricist?: string | null;
  track_number?: number | null;
  disc_number?: number | null;
  release_year?: number | null;
  release_date?: string | null;
  color_name?: string | null;
  artwork_path?: string | null;
  isrc?: string | null;
  hot_cue_auto_load?: boolean | null;
  source_metadata?: Record<string, unknown>;
  created_at: string;
  // Analysis pipeline fields (null until analysis files are parsed)
  master_db_id: string | null;
  master_content_id: string | null;
  analysis_data_file_path: string | null;
  analysed_bits: number | null;
  cue_update_count: number | null;
  analysis_data_update_count: number | null;
  information_update_count: number | null;
  analysis_reused_from_track_id: string | null;
  analysis_parse_status: RekordboxTrackParseStatus | null;
  analysis_parse_warnings: unknown[];
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

// ── Rekordbox analysis tables ─────────────────────────────────────────────────

export type RekordboxAssetType = 'DAT' | 'EXT' | '2EX';

export type RekordboxAssetUploadStatus =
  'pending' | 'uploading' | 'uploaded' | 'failed';

export type RekordboxAssetParseStatus =
  'not_requested' | 'queued' | 'parsing' | 'completed' | 'failed' | 'skipped';

export interface RekordboxAnalysisAsset {
  id: string;
  import_id: string;
  track_id: string | null;
  asset_type: RekordboxAssetType;
  relative_path: string;
  original_filename: string;
  sha256: string;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  upload_status: RekordboxAssetUploadStatus;
  parse_status: RekordboxAssetParseStatus;
  parser_version: string | null;
  parse_warnings: unknown[];
  uploaded_at: string | null;
  parsed_at: string | null;
  created_at: string;
}

export interface RekordboxBeatEntry {
  seq: number;
  srcIdx: number;
  beatInBar: number;
  bar: number;
  ms: number;
  bpm: number;
  isDownbeat: boolean;
}

export interface RekordboxTrackBeatGrid {
  id: string;
  import_id: string;
  track_id: string;
  source_tag: string | null;
  beats: RekordboxBeatEntry[];
  beat_count: number | null;
  downbeat_count: number | null;
  bar_count: number | null;
  first_beat_ms: number | null;
  first_downbeat_ms: number | null;
  minimum_bpm: number | null;
  maximum_bpm: number | null;
  is_variable_tempo: boolean | null;
  parser_version: string | null;
  source_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RekordboxWaveformColumn {
  height: number;
  whiteness: number;
  color?: number;
}

export interface RekordboxTrackWaveform {
  id: string;
  import_id: string;
  track_id: string;
  preview_format: string | null;
  preview_column_count: number | null;
  preview_columns: RekordboxWaveformColumn[];
  detail_format: string | null;
  detail_column_count: number | null;
  detail_storage_bucket: string | null;
  detail_storage_path: string | null;
  source_dat_asset_id: string | null;
  source_ext_asset_id: string | null;
  source_2ex_asset_id: string | null;
  parser_version: string | null;
  created_at: string;
  updated_at: string;
}

export type RekordboxCueFamily = 'hot' | 'memory';

export type RekordboxCuePointType = 'cue' | 'loop';

export interface RekordboxCue {
  id: string;
  import_id: string;
  track_id: string;
  rekordbox_cue_id: string | null;
  dedupe_key: string;
  cue_family: RekordboxCueFamily;
  hot_cue_slot: number | null;
  point_type: RekordboxCuePointType;
  source_kind: string | null;
  start_usec: number | null;
  end_usec: number | null;
  start_ms: number | null;
  end_ms: number | null;
  color_table_index: number | null;
  color_hex: string | null;
  color_name?: string | null;
  comment: string | null;
  is_active_loop: boolean | null;
  beat_loop_numerator: number | null;
  beat_loop_denominator: number | null;
  source_db_present: boolean;
  source_anlz_present: boolean;
  source_conflict: boolean;
  source_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RekordboxTrackPhrase {
  id: string;
  import_id: string;
  track_id: string;
  phrase_index: number;
  source_mood: string | null;
  source_kind: string | null;
  source_bank: string | null;
  normalized_label: string | null;
  start_beat: number | null;
  end_beat: number | null;
  start_ms: number | null;
  end_ms: number | null;
  fill_start_beat: number | null;
  fill_start_ms: number | null;
  source_flags: Record<string, unknown>;
  source_payload: Record<string, unknown>;
  parser_version: string | null;
  created_at: string;
}

export interface RekordboxRecommendationEdge {
  id: string;
  import_id: string;
  source_track_id: string;
  target_track_id: string;
  source_content_id: string | null;
  target_content_id: string | null;
  rating: number | null;
  source_created_at: string | null;
  relationship_source: string;
  direction_preserved: boolean;
  source_payload: Record<string, unknown>;
  created_at: string;
}

export interface RekordboxRelatedTrackList {
  id: string;
  import_id: string;
  source_list_id: string;
  parent_list_id: string | null;
  name: string;
  sort_order: number | null;
  is_folder: boolean;
  attribute: string | null;
  criteria_raw: Record<string, unknown>;
  criteria_normalized: Record<string, unknown>;
  source_database_id: string | null;
  created_at: string;
}

export interface RekordboxRelatedTrackMember {
  related_list_id: string;
  track_id: string;
  position: number;
  relationship_type: string | null;
  source_payload: Record<string, unknown>;
  created_at: string;
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

export type DiscoveryScrapeStatus =
  'queued' | 'running' | 'completed' | 'failed';

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
  track_number?: number | null;
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
  detail_scrape_status:
    'not_scraped' | 'queued' | 'running' | 'completed' | 'failed';
  detail_scraped_at: string | null;
  detail_scrape_error: string | null;
  has_timed_cues: boolean | null;
}

export interface DiscoverySetTracklistDetail {
  setlist: DiscoverySetlistDetailSummary;
  tracks: DiscoverySetTrack[];
}

export interface DiscoveryArtistGenre {
  id: string;
  name: string;
}

export interface DiscoveryArtistDetail {
  id: string;
  name: string;
  normalized_name: string | null;
  aliases: string[];
  source: string | null;
  source_artist_url: string | null;
  profile_image_url: string | null;
  genres: DiscoveryArtistGenre[];
  stored_setlist_count: number;
  stored_track_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface FeedArtist {
  id: string;
  name: string;
  normalized_name: string | null;
  profile_image_url: string | null;
  setlist_count: number;
  genres: DiscoveryArtistGenre[];
}

// ── User profile ──────────────────────────────────────────────────────────────

export interface UserProfile {
  user_id: string;
  display_name: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

// ── User preferences ──────────────────────────────────────────────────────────

export interface UserArtistPreference {
  user_id: string;
  artist_id: string;
  position: number;
  created_at: string;
  artist?: {
    id: string;
    name: string;
    normalized_name: string | null;
    profile_image_url: string | null;
  };
}

export interface UserGenrePreference {
  user_id: string;
  genre_id: string;
  position: number;
  created_at: string;
  genre?: {
    id: string;
    name: string;
    normalized_name: string;
  };
}

// ── User searches ─────────────────────────────────────────────────────────────

export type UserSearchResultType = 'artist' | 'genre' | 'setlist';

export interface UserSearch {
  id: string;
  user_id: string;
  query_text: string;
  normalized_query: string;
  result_type: UserSearchResultType | null;
  result_id: string | null;
  search_count: number;
  last_searched_at: string;
  created_at: string;
}

// ── User playlist profile ─────────────────────────────────────────────────────

export interface UserPlaylistProfile {
  id: string;
  user_id: string;
  playlist_identity_key: string;
  display_name: string | null;
  description: string | null;
  artwork_url: string | null;
  created_at: string;
  updated_at: string;
}

// ── Similar Vibes scoring types ───────────────────────────────────────────────

export interface RecommendationReason {
  kind:
    | 'rekordbox_match'
    | 'reciprocal_match'
    | 'same_camelot'
    | 'relative_key'
    | 'adjacent_camelot'
    | 'energy_boost'
    | 'bpm_proximity'
    | 'same_genre'
    | 'same_label';
  label: string;
  score: number;
}

export interface RekordboxEvidence {
  rating: number | null;
  direction: 'outgoing' | 'incoming' | 'reciprocal';
  createdAt: string | null;
  relationshipSource: 'recommended_like';
}

export interface SimilarTrackResult {
  track: RekordboxTrack;
  recommendationScore: number;
  reasons: RecommendationReason[];
  rekordboxEvidence?: RekordboxEvidence;
}
