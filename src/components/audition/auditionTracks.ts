import { nextRecordSort, sortRecordTracks } from '../ui/display/recordTrackSorting';
import { formatKey } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';

export type AuditionSortColumn = 'title' | 'artist' | 'genre' | 'key' | 'bpm' | 'length' | 'format' | 'sampleRate' | 'bitRate' | 'playlists' | 'date-added';
export type AuditionSortDirection = 'asc' | 'desc';

export interface AuditionSort {
  column: AuditionSortColumn;
  direction: AuditionSortDirection;
}

export interface AuditionFilters {
  /** Key exactly as the library statistics name it; empty means every key. */
  key: string;
  /** Inclusive tempo range; null leaves tracks with unknown BPM visible. */
  bpmRange: [number, number] | null;
}

export function filterAuditionTracks(tracks: readonly RekordboxTrack[], filters: AuditionFilters): RekordboxTrack[] {
  return tracks.filter((track) => {
    if (filters.key && formatKey(track.musical_key) !== filters.key) return false;
    if (filters.bpmRange) {
      if (track.bpm == null || !Number.isFinite(track.bpm) || track.bpm < filters.bpmRange[0] || track.bpm > filters.bpmRange[1]) return false;
    }
    return true;
  });
}

/** Shared record ordering also keeps the Audition playback queue aligned with the table. */
export function sortAuditionTracks(tracks: readonly RekordboxTrack[], sort: AuditionSort | null, playlistCounts?: ReadonlyMap<string, number>): RekordboxTrack[] {
  return sortRecordTracks(tracks, sort, playlistCounts);
}

/** Header clicks alternate ascending and descending. */
export function nextAuditionSort(current: AuditionSort | null, column: AuditionSortColumn): AuditionSort {
  return nextRecordSort(current, column);
}

export interface TimeRulerTick {
  ms: number;
  label: string;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const RULER_STEPS_SECONDS = [10, 15, 30, 60, 120] as const;
const RULER_MAX_TICKS = 14;

/** Evenly spaced labels from 0:00 using the smallest step that keeps the ruler readable. */
export function timeRulerTicks(durationMs: number | null): TimeRulerTick[] {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return [];
  const durationSeconds = durationMs / 1000;
  const step = RULER_STEPS_SECONDS.find((candidate) => durationSeconds / candidate <= RULER_MAX_TICKS)
    ?? RULER_STEPS_SECONDS[RULER_STEPS_SECONDS.length - 1];
  const ticks: TimeRulerTick[] = [];
  for (let seconds = 0; seconds < durationSeconds; seconds += step) {
    ticks.push({ ms: seconds * 1000, label: formatClock(seconds * 1000) });
  }
  return ticks;
}

/** "14 of 387", or "14 of 387+" when the list is only part of what matches. */
export function auditionPositionLabel(index: number, count: number, moreToLoad: boolean): string | null {
  if (index < 0 || count <= 0) return null;
  return `${index + 1} of ${count.toLocaleString()}${moreToLoad ? '+' : ''}`;
}
