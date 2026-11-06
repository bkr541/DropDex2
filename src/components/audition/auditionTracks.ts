import { formatCamelotCode } from '../ui/display/camelotKey';
import { formatKey } from '../../lib/utils';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import type { RekordboxTrack } from '../../types';

export type AuditionSortColumn = 'title' | 'artist' | 'genre' | 'key' | 'bpm' | 'length' | 'format' | 'sampleRate' | 'bitRate' | 'playlists';
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

function sortValue(track: RekordboxTrack, column: AuditionSortColumn, playlistCounts?: ReadonlyMap<string, number>): string | number | null {
  switch (column) {
    case 'title': return track.title ?? '';
    case 'artist': return track.artist ?? '';
    case 'genre': return track.genre ?? '';
    case 'key': return formatCamelotCode(track.musical_key);
    case 'bpm': return track.bpm;
    case 'length': return durationMsForTrack(track, null);
    case 'format': return track.file_format ?? '';
    case 'sampleRate': return track.sample_rate_hz > 0 ? track.sample_rate_hz : null;
    case 'bitRate': return track.bitrate_kbps > 0 ? track.bitrate_kbps : null;
    // Tracks whose count has not loaded yet have no value, so they sort last.
    case 'playlists': return playlistCounts?.get(track.id) ?? null;
  }
}

/** Returns a new list. Tracks with no value for the column always sort last. */
export function sortAuditionTracks(tracks: readonly RekordboxTrack[], sort: AuditionSort | null, playlistCounts?: ReadonlyMap<string, number>): RekordboxTrack[] {
  if (!sort) return [...tracks];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const av = sortValue(a, sort.column, playlistCounts);
    const bv = sortValue(b, sort.column, playlistCounts);
    const aMissing = av === null || av === '';
    const bMissing = bv === null || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * direction;
  });
}

/** Header click cycle: ascending, then descending, then back to the library order. */
export function nextAuditionSort(current: AuditionSort | null, column: AuditionSortColumn): AuditionSort | null {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
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
