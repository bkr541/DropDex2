import type { RekordboxTrack } from '../../types';
import type { BeatGridRow, PhraseRow } from '../../lib/queries/analysisData';
import { resolveTrackCamelotCode } from '../../features/roulette/rouletteMatching';

export type FlipLabPhraseTone = 'intro' | 'verse' | 'build' | 'drop' | 'chorus' | 'neutral';

export interface FlipLabTimelineSegment {
  label: string;
  tone: FlipLabPhraseTone;
  startPercent: number;
  endPercent: number;
}

export interface FlipLabBarLine {
  bar: number;
  percent: number;
  /** Every fourth bar (1, 5, 9, …) is drawn stronger. */
  major: boolean;
  first: boolean;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function resolveFlipLabArtist(
  track: Pick<RekordboxTrack, 'artist'> | null,
  noSelectionLabel: string,
): string {
  if (!track) return noSelectionLabel;
  const artist = track.artist?.trim();
  return artist ? artist : 'Unknown artist';
}

export function resolveFlipLabCamelotKey(
  track: Pick<RekordboxTrack, 'camelot_key' | 'key_tonic' | 'key_mode'> | null,
): string | null {
  if (!track) return null;
  return resolveTrackCamelotCode(track);
}

export function trackDurationMs(
  track: Pick<RekordboxTrack, 'duration_ms' | 'duration_seconds'> | null,
): number | null {
  if (!track) return null;
  if (finitePositive(track.duration_ms)) return track.duration_ms;
  if (finitePositive(track.duration_seconds)) return track.duration_seconds * 1000;
  return null;
}

function phraseTone(label: string | null): FlipLabPhraseTone {
  const normalized = label?.trim().toLowerCase() ?? '';
  if (normalized.includes('intro')) return 'intro';
  if (normalized.includes('verse')) return 'verse';
  if (normalized.includes('build') || normalized.includes('rise')) return 'build';
  if (normalized.includes('drop')) return 'drop';
  if (normalized.includes('chorus') || normalized.includes('hook')) return 'chorus';
  return 'neutral';
}

function phraseLabel(phrase: PhraseRow): string {
  const normalized = phrase.normalized_label?.trim();
  return normalized || 'Unknown';
}

function finitePhraseEnd(phrases: PhraseRow[]): number | null {
  let maximum: number | null = null;
  for (const phrase of phrases) {
    if (!Number.isFinite(phrase.end_ms)) continue;
    maximum = maximum == null ? phrase.end_ms : Math.max(maximum, phrase.end_ms as number);
  }
  return maximum;
}

/** Rekordbox phrase timing as percentages of the whole track. */
export function mapPhrasesToTimelineSegments(
  phrases: PhraseRow[],
  durationMs: number | null,
): FlipLabTimelineSegment[] {
  if (phrases.length === 0) return [];
  const rangeEnd = durationMs ?? finitePhraseEnd(phrases);
  if (!finitePositive(rangeEnd)) return [];

  return phrases.flatMap((phrase) => {
    if (!Number.isFinite(phrase.start_ms)) return [];
    const startMs = Math.max(0, phrase.start_ms as number);
    const endMs = Math.min(rangeEnd, Number.isFinite(phrase.end_ms) ? phrase.end_ms as number : rangeEnd);
    if (endMs <= startMs) return [];
    return [{
      label: phraseLabel(phrase),
      tone: phraseTone(phrase.normalized_label ?? phrase.source_kind),
      startPercent: clampPercent((startMs / rangeEnd) * 100),
      endPercent: clampPercent((endMs / rangeEnd) * 100),
    }];
  });
}

/** Bar lines (downbeats) from the stored Rekordbox beat grid, as track percentages. */
export function flipLabBarLines(grid: BeatGridRow | null, durationMs: number | null): FlipLabBarLine[] {
  if (!grid || !finitePositive(durationMs)) return [];
  const downbeats = grid.beats.filter((beat) => beat.isDownbeat && Number.isFinite(beat.ms) && beat.ms >= 0 && beat.ms <= durationMs);
  return downbeats.map((beat, index) => ({
    bar: beat.bar,
    percent: clampPercent((beat.ms / durationMs) * 100),
    major: index % 4 === 0,
    first: index === 0,
  }));
}
