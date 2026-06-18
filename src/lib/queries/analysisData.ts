/**
 * Typed Supabase queries for Rekordbox ANLZ analysis data.
 *
 * All queries enforce user ownership via RLS (import_id → user_id).
 * No service-role key is used here; reads go through the anon/user JWT.
 */

import { supabase } from '../supabase';
import {
  buildTrackPreviewWaveform,
  chunkIds,
} from './waveformValidation';
import type {
  PreviewColumn,
  WaveformRow,
  TrackPreviewWaveform,
} from './waveformValidation';

// Re-export column types and waveform types so existing import paths keep working.
export type {
  PreviewColumnColor,
  PreviewColumnMono,
  PreviewColumn,
  WaveformRow,
  WaveformPreviewFormat,
  WaveformLoadState,
  TrackPreviewWaveform,
} from './waveformValidation';

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

// ── Row mappers ───────────────────────────────────────────────────────────────

function mapBeatGridRow(raw: unknown): BeatGridRow {
  const row = raw as Record<string, unknown>;
  return {
    id: row.id as string,
    import_id: row.import_id as string,
    track_id: row.track_id as string,
    source_tag: (row.source_tag as string | null) ?? null,
    beats: (row.beats as BeatEntry[]) ?? [],
    beat_count: (row.beat_count as number | null) ?? null,
    downbeat_count: (row.downbeat_count as number | null) ?? null,
    bar_count: (row.bar_count as number | null) ?? null,
    first_beat_ms: (row.first_beat_ms as number | null) ?? null,
    first_downbeat_ms: (row.first_downbeat_ms as number | null) ?? null,
    minimum_bpm: (row.minimum_bpm as number | null) ?? null,
    maximum_bpm: (row.maximum_bpm as number | null) ?? null,
    is_variable_tempo: (row.is_variable_tempo as boolean | null) ?? null,
    parser_version: (row.parser_version as string | null) ?? null,
  };
}

function mapWaveformRow(raw: unknown): WaveformRow {
  const row = raw as Record<string, unknown>;
  return {
    id: row.id as string,
    import_id: row.import_id as string,
    track_id: row.track_id as string,
    preview_format: (row.preview_format as string | null) ?? null,
    preview_column_count: (row.preview_column_count as number | null) ?? null,
    preview_columns: (row.preview_columns as PreviewColumn[]) ?? [],
    detail_format: (row.detail_format as string | null) ?? null,
    detail_column_count: (row.detail_column_count as number | null) ?? null,
    detail_storage_bucket: (row.detail_storage_bucket as string | null) ?? null,
    detail_storage_path: (row.detail_storage_path as string | null) ?? null,
    parser_version: (row.parser_version as string | null) ?? null,
  };
}

function mapCueRow(raw: unknown): CueRow {
  const row = raw as Record<string, unknown>;
  return {
    id: row.id as string,
    import_id: row.import_id as string,
    track_id: row.track_id as string,
    rekordbox_cue_id: (row.rekordbox_cue_id as string | null) ?? null,
    dedupe_key: row.dedupe_key as string,
    cue_family: row.cue_family as 'hot' | 'memory',
    hot_cue_slot: (row.hot_cue_slot as number | null) ?? null,
    point_type: row.point_type as 'cue' | 'loop',
    source_kind: (row.source_kind as string | null) ?? null,
    start_ms: (row.start_ms as number | null) ?? null,
    end_ms: (row.end_ms as number | null) ?? null,
    color_table_index: (row.color_table_index as number | null) ?? null,
    color_hex: (row.color_hex as string | null) ?? null,
    color_name: (row.color_name as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
    is_active_loop: (row.is_active_loop as boolean | null) ?? null,
    beat_loop_numerator: (row.beat_loop_numerator as number | null) ?? null,
    beat_loop_denominator: (row.beat_loop_denominator as number | null) ?? null,
    source_db_present: row.source_db_present as boolean,
    source_anlz_present: row.source_anlz_present as boolean,
    source_conflict: row.source_conflict as boolean,
  };
}

function mapPhraseRow(raw: unknown): PhraseRow {
  const row = raw as Record<string, unknown>;
  return {
    id: row.id as string,
    import_id: row.import_id as string,
    track_id: row.track_id as string,
    phrase_index: row.phrase_index as number,
    source_mood: (row.source_mood as string | null) ?? null,
    source_kind: (row.source_kind as string | null) ?? null,
    source_bank: (row.source_bank as string | null) ?? null,
    normalized_label: (row.normalized_label as string | null) ?? null,
    start_beat: (row.start_beat as number | null) ?? null,
    end_beat: (row.end_beat as number | null) ?? null,
    start_ms: (row.start_ms as number | null) ?? null,
    end_ms: (row.end_ms as number | null) ?? null,
    fill_start_beat: (row.fill_start_beat as number | null) ?? null,
    fill_start_ms: (row.fill_start_ms as number | null) ?? null,
    source_flags: (row.source_flags as Record<string, unknown>) ?? {},
    source_payload: (row.source_payload as Record<string, unknown>) ?? {},
    parser_version: (row.parser_version as string | null) ?? null,
  };
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
  if (data == null) return null;
  return mapBeatGridRow(data);
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
  if (data == null) return null;
  return mapWaveformRow(data);
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
  return (data ?? []).map((row) => mapCueRow(row));
}

// ── Bulk waveform fetch ────────────────────────────────────────────────────────

/** Max track IDs per Supabase .in() call — keeps requests well under limits. */
export const WAVEFORM_CHUNK_SIZE = 200;

const WAVEFORM_SELECT =
  'id, import_id, track_id, preview_format, preview_column_count, preview_columns, ' +
  'detail_format, detail_column_count, detail_storage_bucket, detail_storage_path, parser_version';

export interface WaveformChunkError {
  chunkIndex: number;
  /** IDs that were in this chunk and could not be queried. */
  trackIds: string[];
  error: string;
}

export interface WaveformFetchResult {
  /** Waveform data for every track that had a row, keyed by track_id. */
  waveforms: Map<string, TrackPreviewWaveform>;
  /**
   * Track IDs that were successfully queried (chunk returned without error).
   * IDs in this set that are absent from `waveforms` are confirmed to have no
   * waveform row — safe to cache as permanently unavailable.
   */
  successfulTrackIds: Set<string>;
  /**
   * Per-chunk errors; other chunks continue even if one fails.
   * IDs in a failed chunk must NOT be cached as unavailable — the query may
   * succeed on a later retry.
   */
  errors: WaveformChunkError[];
}

/**
 * Fetch preview waveform data for multiple tracks in a single query (or a
 * small number of batched queries when the ID list exceeds WAVEFORM_CHUNK_SIZE).
 *
 * - Deduplicates input IDs before querying.
 * - Tracks with no waveform row are omitted from the result map (not an error).
 * - A chunk error does not fail the entire call — other chunks still complete.
 * - `successfulTrackIds` identifies which IDs were cleanly queried so the
 *   caller can distinguish "confirmed absent" from "query failed".
 */
export async function fetchTrackPreviewWaveforms(
  trackIds: string[],
): Promise<WaveformFetchResult> {
  const chunks = chunkIds(trackIds, WAVEFORM_CHUNK_SIZE);
  const result: WaveformFetchResult = {
    waveforms: new Map(),
    successfulTrackIds: new Set(),
    errors: [],
  };

  if (chunks.length === 0) return result;

  await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      try {
        const { data, error } = await supabase
          .from('rekordbox_track_waveforms')
          .select(WAVEFORM_SELECT)
          .in('track_id', chunk);

        if (error) {
          result.errors.push({ chunkIndex, trackIds: chunk, error: error.message });
          if (import.meta.env.DEV) {
            console.warn(
              `[DropDex] Waveform chunk ${chunkIndex} failed (${chunk.length} IDs, retryable): ${error.message}`,
            );
          }
          return;
        }

        // All IDs in this chunk were cleanly queried — missing rows = truly absent.
        for (const id of chunk) result.successfulTrackIds.add(id);

        for (const raw of data ?? []) {
          const waveform = buildTrackPreviewWaveform(mapWaveformRow(raw));
          result.waveforms.set(waveform.trackId, waveform);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push({ chunkIndex, trackIds: chunk, error: message });
        if (import.meta.env.DEV) {
          console.warn(
            `[DropDex] Waveform chunk ${chunkIndex} threw (${chunk.length} IDs, retryable): ${message}`,
          );
        }
      }
    }),
  );

  return result;
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
  return (data ?? []).map((row) => mapPhraseRow(row));
}
