/**
 * Pure mapping functions for Rekordbox track data.
 *
 * No Supabase dependency — safe to import in unit tests without environment
 * variables. Query functions that require Supabase live in
 * `src/lib/queries/rekordbox.ts`.
 */

import type { RekordboxTrack } from '../../types';

/**
 * Lightweight projection of a rekordbox_tracks row returned by
 * `fetchTrackStats`. Contains only the columns that function selects.
 */
export interface TrackStatRow {
  id: string;
  import_id: string;
  rekordbox_content_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
  musical_key: string | null;
  camelot_key: string | null;
  date_added: string | null;
  duration_seconds: number | null;
  file_path: string | null;
  file_format: string | null;
}

/** Map a lightweight TrackStatRow (from fetchTrackStats) to a full RekordboxTrack shape. */
export function trackStatRowToTrack(row: TrackStatRow): RekordboxTrack {
  return {
    id: row.id,
    import_id: row.import_id,
    rekordbox_content_id: row.rekordbox_content_id,
    title: row.title,
    artist: row.artist,
    album: null,
    remixer: null,
    genre: row.genre,
    label: null,
    musical_key: row.musical_key,
    camelot_key: row.camelot_key,
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm: row.bpm,
    duration_seconds: row.duration_seconds,
    rating: null,
    comments: null,
    file_path: row.file_path,
    file_format: row.file_format,
    date_added: row.date_added,
    created_at: '',
    master_db_id: null,
    master_content_id: null,
    analysis_data_file_path: null,
    analysed_bits: null,
    cue_update_count: null,
    analysis_data_update_count: null,
    information_update_count: null,
    analysis_reused_from_track_id: null,
    analysis_parse_status: null,
    analysis_parse_warnings: [],
  };
}
