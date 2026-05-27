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
