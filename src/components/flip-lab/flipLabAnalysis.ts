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

function beatMs(grid: BeatGridRow | null, beatNumber: number | null | undefined): number | null {
  if (beatNumber == null || !grid) return null;
  return grid.beats.find((beat) => beat.seq === beatNumber)?.ms ?? null;
}

/**
 * Rekordbox phrase timing as percentages of the whole track. Phrases that only
 * carry beat numbers are placed using the beat grid, the same way CuePoints does.
 */
export function mapPhrasesToTimelineSegments(
  phrases: PhraseRow[],
  durationMs: number | null,
  grid: BeatGridRow | null = null,
): FlipLabTimelineSegment[] {
  if (phrases.length === 0) return [];
  const rangeEnd = durationMs ?? finitePhraseEnd(phrases);
  if (!finitePositive(rangeEnd)) return [];

  const timed = phrases
    .map((phrase) => ({
      phrase,
      startMs: Number.isFinite(phrase.start_ms) ? phrase.start_ms as number : beatMs(grid, phrase.start_beat),
      endMs: Number.isFinite(phrase.end_ms) ? phrase.end_ms as number : beatMs(grid, phrase.end_beat),
    }))
    .filter((entry): entry is { phrase: PhraseRow; startMs: number; endMs: number | null } => entry.startMs != null)
    .sort((a, b) => a.startMs - b.startMs);

  return timed.flatMap((entry, index) => {
    const startMs = Math.max(0, entry.startMs);
    const fallbackEnd = timed[index + 1]?.startMs ?? rangeEnd;
    const endMs = Math.min(rangeEnd, entry.endMs ?? fallbackEnd);
    if (endMs <= startMs) return [];
    return [{
      label: phraseLabel(entry.phrase),
      tone: phraseTone(entry.phrase.normalized_label ?? entry.phrase.source_kind),
      startPercent: clampPercent((startMs / rangeEnd) * 100),
      endPercent: clampPercent((endMs / rangeEnd) * 100),
    }];
  });
}
