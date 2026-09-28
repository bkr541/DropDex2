import type { RekordboxTrack } from '../../types';
import { isUsableBeatGrid, type BeatEntry } from '../../lib/music/beatGridHelpers';
import { phraseAtMs } from '../../lib/music/phraseHelpers';
import type { BeatGridRow, PhraseRow } from '../../lib/queries/analysisData';
import type { RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import { resolveRouletteAlignment } from '../../features/roulette/rouletteAlignment';
import { resolveTrackCamelotCode } from '../../features/roulette/rouletteMatching';

export type FlipLabPhraseTone = 'intro' | 'verse' | 'build' | 'drop' | 'chorus' | 'neutral';

export interface FlipLabTimelineSegment {
  label: string;
  tone: FlipLabPhraseTone;
  startPercent: number;
  endPercent: number;
}

export interface FlipLabBarMarker {
  label: string;
  percent: number;
}

export type FlipLabBarRuler =
  | { status: 'available'; shared: boolean; markers: FlipLabBarMarker[] }
  | { status: 'unavailable'; shared: false; markers: [] };

export type FlipLabAlignmentState =
  | { status: 'aligned'; label: 'Aligned'; subtitle: string | null }
  | { status: 'offset'; label: string; subtitle: string | null }
  | { status: 'unavailable'; label: 'Analysis unavailable'; subtitle: string | null }
  | { status: 'cannot-align'; label: 'Cannot align'; subtitle: string | null };

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

/**
 * Resolve the visible Camelot key from the exact same sources used by Flip Lab
 * compatibility analysis. Literal display-only fallbacks such as "N/A" never
 * become compatibility keys.
 */
export function resolveFlipLabCamelotKey(
  track: Pick<RekordboxTrack, 'camelot_key' | 'key_tonic' | 'key_mode'> | null,
): string | null {
  if (!track) return null;
  return resolveTrackCamelotCode(track);
}

/**
 * Signed tempo change required on the Vocal to reach the Instrumental target.
 * Positive means speed the Vocal up; negative means slow the Vocal down.
 */
export function signedVocalBpmDelta(
  vocalBpm: number | null | undefined,
  instrumentalBpm: number | null | undefined,
): number | null {
  if (!finitePositive(vocalBpm) || !finitePositive(instrumentalBpm)) return null;
  const delta = instrumentalBpm - vocalBpm;
  return Math.abs(delta) < 0.000_001 ? 0 : delta;
}

export function formatSignedBpmDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  if (delta === 0) return '0.0 BPM';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} BPM`;
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

/**
 * Convert real Rekordbox phrase timing into the current section-lane geometry.
 * When a prepared audition window exists, percentages are window-relative.
 */
export function mapPhrasesToTimelineSegments(
  phrases: PhraseRow[],
  durationMs: number | null,
  window: RoulettePreviewWindow | null,
): FlipLabTimelineSegment[] {
  if (phrases.length === 0) return [];
  const rangeStart = window?.sourceTimeMs ?? 0;
  const rangeEnd = window?.windowEndMs ?? durationMs ?? finitePhraseEnd(phrases);
  if (!finitePositive(rangeEnd) || rangeEnd <= rangeStart) return [];
  const span = rangeEnd - rangeStart;

  return phrases.flatMap((phrase) => {
    if (!Number.isFinite(phrase.start_ms)) return [];
    const startMs = phrase.start_ms as number;
    const endMs = Number.isFinite(phrase.end_ms) ? phrase.end_ms as number : rangeEnd;
    const clippedStart = Math.max(rangeStart, startMs);
    const clippedEnd = Math.min(rangeEnd, endMs);
    if (clippedEnd <= clippedStart) return [];

    return [{
      label: phraseLabel(phrase),
      tone: phraseTone(phrase.normalized_label ?? phrase.source_kind),
      startPercent: clampPercent(((clippedStart - rangeStart) / span) * 100),
      endPercent: clampPercent(((clippedEnd - rangeStart) / span) * 100),
    }];
  });
}

function downbeatsInWindow(
  grid: BeatGridRow | null,
  window: RoulettePreviewWindow | null,
): BeatEntry[] {
  if (!grid || !window || !isUsableBeatGrid(grid.beats)) return [];
  return grid.beats.filter((beat) => (
    beat.isDownbeat
    && beat.beatInBar === 1
    && beat.ms >= window.sourceTimeMs - 2
    && beat.ms < window.windowEndMs - 1
  ));
}

function markerPercent(beat: BeatEntry, window: RoulettePreviewWindow): number {
  return clampPercent(((beat.ms - window.sourceTimeMs) / window.durationMs) * 100);
}

/**
 * Build a truthful ruler from stored Rekordbox downbeats. Two prepared windows
 * produce a shared virtual bar range only when their requested bar spans match
 * and the corresponding real downbeats occupy compatible window positions.
 */
export function deriveFlipLabBarRuler(
  vocalGrid: BeatGridRow | null,
  instrumentalGrid: BeatGridRow | null,
  vocalWindow: RoulettePreviewWindow | null,
  instrumentalWindow: RoulettePreviewWindow | null,
): FlipLabBarRuler {
  if (vocalWindow && instrumentalWindow) {
    if (vocalWindow.requestedBars !== instrumentalWindow.requestedBars) {
      return { status: 'unavailable', shared: false, markers: [] };
    }
    const bars = vocalWindow.requestedBars;
    const vocalDownbeats = downbeatsInWindow(vocalGrid, vocalWindow).slice(0, bars);
    const instrumentalDownbeats = downbeatsInWindow(instrumentalGrid, instrumentalWindow).slice(0, bars);
    if (vocalDownbeats.length < bars || instrumentalDownbeats.length < bars) {
      return { status: 'unavailable', shared: false, markers: [] };
    }

    const fractionsCompatible = vocalDownbeats.every((beat, index) => {
      const vocalPercent = markerPercent(beat, vocalWindow);
      const instrumentalPercent = markerPercent(instrumentalDownbeats[index], instrumentalWindow);
      return Math.abs(vocalPercent - instrumentalPercent) <= 3;
    });
    if (!fractionsCompatible) return { status: 'unavailable', shared: false, markers: [] };

    const markers = vocalDownbeats.flatMap((beat, index) => {
      if (index % 4 !== 0) return [];
      const vocalPercent = markerPercent(beat, vocalWindow);
      const instrumentalPercent = markerPercent(instrumentalDownbeats[index], instrumentalWindow);
      return [{ label: String(index + 1), percent: (vocalPercent + instrumentalPercent) / 2 }];
    });
    return markers.length > 0
      ? { status: 'available', shared: true, markers }
      : { status: 'unavailable', shared: false, markers: [] };
  }

  const singleWindow = instrumentalWindow ?? vocalWindow;
  const singleGrid = instrumentalWindow ? instrumentalGrid : vocalGrid;
  if (!singleWindow || !singleGrid) return { status: 'unavailable', shared: false, markers: [] };
  const downbeats = downbeatsInWindow(singleGrid, singleWindow).slice(0, singleWindow.requestedBars);
  if (downbeats.length === 0) return { status: 'unavailable', shared: false, markers: [] };
  const markers = downbeats.flatMap((beat, index) => (
    index % 4 === 0
      ? [{ label: beat.bar > 0 ? String(beat.bar) : String(index + 1), percent: markerPercent(beat, singleWindow) }]
      : []
  ));
  return markers.length > 0
    ? { status: 'available', shared: false, markers }
    : { status: 'unavailable', shared: false, markers: [] };
}

function preparedStartBeat(grid: BeatGridRow, window: RoulettePreviewWindow): BeatEntry | null {
  if (!isUsableBeatGrid(grid.beats)) return null;
  if (window.sourceBeatSequence != null) {
    const exactSequence = grid.beats.find((beat) => beat.seq === window.sourceBeatSequence);
    if (exactSequence && Math.abs(exactSequence.ms - window.sourceTimeMs) <= 2) return exactSequence;
  }
  let nearest: BeatEntry | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const beat of grid.beats) {
    const distance = Math.abs(beat.ms - window.sourceTimeMs);
    if (distance < nearestDistance) {
      nearest = beat;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= 2 ? nearest : null;
}

function phraseNameAtWindowStart(phrases: PhraseRow[], window: RoulettePreviewWindow): string | null {
  const phrase = phraseAtMs(phrases, window.sourceTimeMs);
  const label = phrase?.normalized_label?.trim();
  return label || (phrase ? 'Unknown' : null);
}

/**
 * Describe the actual prepared-window alignment. Roulette's canonical alignment
 * helper validates tempo/grid suitability; the final state compares the exact
 * source beats chosen by Prompt 03's audition windows.
 */
export function deriveFlipLabAlignment(
  vocalTrack: Pick<RekordboxTrack, 'id' | 'bpm'> | null,
  instrumentalTrack: Pick<RekordboxTrack, 'id' | 'bpm'> | null,
  vocalGrid: BeatGridRow | null,
  instrumentalGrid: BeatGridRow | null,
  vocalPhrases: PhraseRow[],
  instrumentalPhrases: PhraseRow[],
  vocalWindow: RoulettePreviewWindow | null,
  instrumentalWindow: RoulettePreviewWindow | null,
): FlipLabAlignmentState {
  if (!vocalTrack || !instrumentalTrack) {
    return { status: 'unavailable', label: 'Analysis unavailable', subtitle: 'Select both tracks to analyze alignment.' };
  }
  if (!vocalGrid || !instrumentalGrid || !vocalWindow || !instrumentalWindow) {
    return { status: 'unavailable', label: 'Analysis unavailable', subtitle: 'Prepared beat-grid windows are not available yet.' };
  }
  if (!isUsableBeatGrid(vocalGrid.beats) || !isUsableBeatGrid(instrumentalGrid.beats)) {
    return { status: 'unavailable', label: 'Analysis unavailable', subtitle: 'A usable Rekordbox beat grid is missing.' };
  }
  if (vocalWindow.requestedBars !== instrumentalWindow.requestedBars) {
    return { status: 'cannot-align', label: 'Cannot align', subtitle: 'Prepared audition windows use different bar lengths.' };
  }

  try {
    resolveRouletteAlignment(
      { track: vocalTrack, beatGrid: vocalGrid },
      { track: instrumentalTrack, beatGrid: instrumentalGrid },
    );
  } catch (error) {
    return {
      status: 'cannot-align',
      label: 'Cannot align',
      subtitle: error instanceof Error ? error.message : 'Roulette alignment rejected this pair.',
    };
  }

  const vocalBeat = preparedStartBeat(vocalGrid, vocalWindow);
  const instrumentalBeat = preparedStartBeat(instrumentalGrid, instrumentalWindow);
  if (!vocalBeat || !instrumentalBeat) {
    return { status: 'cannot-align', label: 'Cannot align', subtitle: 'A prepared window does not start on a stored Rekordbox beat.' };
  }

  const beatOffset = vocalBeat.beatInBar - instrumentalBeat.beatInBar;
  const vocalPhrase = phraseNameAtWindowStart(vocalPhrases, vocalWindow);
  const instrumentalPhrase = phraseNameAtWindowStart(instrumentalPhrases, instrumentalWindow);
  const phraseSubtitle = vocalPhrase || instrumentalPhrase
    ? `Vocal ${vocalPhrase ?? 'unknown phrase'} ↔ Instrumental ${instrumentalPhrase ?? 'unknown phrase'}`
    : null;

  if (beatOffset === 0) {
    return {
      status: 'aligned',
      label: 'Aligned',
      subtitle: phraseSubtitle ?? `Both audition windows start on beat ${vocalBeat.beatInBar} of their source bars.`,
    };
  }

  const absoluteOffset = Math.abs(beatOffset);
  return {
    status: 'offset',
    label: `Offset by ${absoluteOffset} beat${absoluteOffset === 1 ? '' : 's'}`,
    subtitle: beatOffset > 0
      ? 'The Vocal window starts later within its source bar than the Instrumental window.'
      : 'The Vocal window starts earlier within its source bar than the Instrumental window.',
  };
}
