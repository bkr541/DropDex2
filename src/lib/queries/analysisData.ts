/**
 * Typed Supabase queries for Rekordbox ANLZ analysis data.
 *
 * All queries enforce user ownership via RLS (import_id → user_id).
 * No service-role key is used here; reads go through the anon/user JWT.
 */

import { supabase } from '../supabase';

// ── Beat grid types ────────────────────────────────────────────────────────────

export interface BeatEntry {
  seq: number;
  srcIdx: number;
  beatInBar: number;
  bar: number;
  ms: number;
  bpm: number;
  isDownbeat: boolean;
}

export interface BeatGridRow {
  id: string;
  import_id: string;
  track_id: string;
  source_tag: string | null;
  beats: BeatEntry[];
  beat_count: number | null;
  downbeat_count: number | null;
  bar_count: number | null;
  first_beat_ms: number | null;
  first_downbeat_ms: number | null;
  minimum_bpm: number | null;
  maximum_bpm: number | null;
  is_variable_tempo: boolean | null;
  parser_version: string | null;
}

// ── Waveform types ─────────────────────────────────────────────────────────────

export interface PreviewColumnColor {
  h: number;
  r: number;
  g: number;
  b: number;
}

export interface PreviewColumnMono {
  h: number;
  i: number;
}

export type PreviewColumn = PreviewColumnColor | PreviewColumnMono;

export interface WaveformRow {
  id: string;
  import_id: string;
  track_id: string;
  preview_format: string | null;
  preview_column_count: number | null;
  preview_columns: PreviewColumn[];
  detail_format: string | null;
  detail_column_count: number | null;
  detail_storage_bucket: string | null;
  detail_storage_path: string | null;
  parser_version: string | null;
}

// ── Cue types ─────────────────────────────────────────────────────────────────

export interface CueRow {
  id: string;
  import_id: string;
  track_id: string;
  rekordbox_cue_id: string | null;
  dedupe_key: string;
  cue_family: 'hot' | 'memory';
  hot_cue_slot: number | null;
  point_type: 'cue' | 'loop';
  source_kind: string | null;
  start_ms: number | null;
  end_ms: number | null;
  color_table_index: number | null;
  color_hex: string | null;
  color_name: string | null;
  comment: string | null;
  is_active_loop: boolean | null;
  beat_loop_numerator: number | null;
  beat_loop_denominator: number | null;
  source_db_present: boolean;
  source_anlz_present: boolean;
  source_conflict: boolean;
}

// ── Phrase types ───────────────────────────────────────────────────────────────

export interface PhraseRow {
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
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Fetch the beat grid for a single track. Returns null when not yet parsed. */
export async function fetchTrackBeatGrid(trackId: string): Promise<BeatGridRow | null> {
  const { data, error } = await supabase
    .from('rekordbox_track_beat_grids')
    .select(
      'id, import_id, track_id, source_tag, beats, beat_count, downbeat_count, ' +
      'bar_count, first_beat_ms, first_downbeat_ms, minimum_bpm, maximum_bpm, ' +
      'is_variable_tempo, parser_version'
    )
    .eq('track_id', trackId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as BeatGridRow | null;
}

/** Fetch the preview waveform for a single track. Returns null when not yet parsed. */
export async function fetchTrackPreviewWaveform(trackId: string): Promise<WaveformRow | null> {
  const { data, error } = await supabase
    .from('rekordbox_track_waveforms')
    .select(
      'id, import_id, track_id, preview_format, preview_column_count, preview_columns, ' +
      'detail_format, detail_column_count, detail_storage_bucket, detail_storage_path, parser_version'
    )
    .eq('track_id', trackId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as WaveformRow | null;
}

/** Fetch all cue points for a single track, ordered by start time. */
export async function fetchTrackCues(trackId: string): Promise<CueRow[]> {
  const { data, error } = await supabase
    .from('rekordbox_cues')
    .select(
      'id, import_id, track_id, rekordbox_cue_id, dedupe_key, cue_family, ' +
      'hot_cue_slot, point_type, source_kind, start_ms, end_ms, ' +
      'color_table_index, color_hex, color_name, comment, is_active_loop, ' +
      'beat_loop_numerator, beat_loop_denominator, ' +
      'source_db_present, source_anlz_present, source_conflict'
    )
    .eq('track_id', trackId)
    .order('start_ms', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CueRow[];
}

/** Fetch all phrase segments for a single track, ordered by phrase index. */
export async function fetchTrackPhrases(trackId: string): Promise<PhraseRow[]> {
  const { data, error } = await supabase
    .from('rekordbox_track_phrases')
    .select(
      'id, import_id, track_id, phrase_index, source_mood, source_kind, source_bank, ' +
      'normalized_label, start_beat, end_beat, start_ms, end_ms, ' +
      'fill_start_beat, fill_start_ms, source_flags, source_payload, parser_version'
    )
    .eq('track_id', trackId)
    .order('phrase_index', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PhraseRow[];
}
