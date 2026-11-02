import { formatCamelotCode } from '../ui/display/camelotKey';
import { formatKey } from '../../lib/utils';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import type { RekordboxTrack } from '../../types';

export type AuditionSortColumn = 'title' | 'artist' | 'genre' | 'key' | 'bpm' | 'length';
export type AuditionSortDirection = 'asc' | 'desc';

export interface AuditionSort {
  column: AuditionSortColumn;
  direction: AuditionSortDirection;
}

export interface AuditionFilters {
  /** Key exactly as the library statistics name it; empty means every key. */
  key: string;
  /** Lower edge of a 10-BPM band, as a string; empty means every tempo. */
  bpmBand: string;
}

export const AUDITION_BPM_BAND_WIDTH = 10;

export function bpmBandStart(bpm: number): number {
  return Math.floor(bpm / AUDITION_BPM_BAND_WIDTH) * AUDITION_BPM_BAND_WIDTH;
}

/** One option per 10-BPM band that actually contains tracks in the library. */
export function bpmBandOptions(bpmTotals: ReadonlyArray<{ bpm: number; count: number }>): Array<{ value: string; label: string }> {
  const counts = new Map<number, number>();
  for (const { bpm, count } of bpmTotals) {
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    const start = bpmBandStart(bpm);
    counts.set(start, (counts.get(start) ?? 0) + count);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      value: String(start),
      label: `${start}–${start + AUDITION_BPM_BAND_WIDTH - 1} (${count})`,
    }));
}

export function filterAuditionTracks(tracks: readonly RekordboxTrack[], filters: AuditionFilters): RekordboxTrack[] {
  const bandStart = filters.bpmBand === '' ? null : Number(filters.bpmBand);
  return tracks.filter((track) => {
    if (filters.key && formatKey(track.musical_key) !== filters.key) return false;
    if (bandStart != null && Number.isFinite(bandStart)) {
      if (track.bpm == null || bpmBandStart(track.bpm) !== bandStart) return false;
    }
    return true;
  });
}

function sortValue(track: RekordboxTrack, column: AuditionSortColumn): string | number | null {
  switch (column) {
    case 'title': return track.title ?? '';
    case 'artist': return track.artist ?? '';
    case 'genre': return track.genre ?? '';
    case 'key': return formatCamelotCode(track.musical_key);
    case 'bpm': return track.bpm;
    case 'length': return durationMsForTrack(track, null);
  }
}

/** Returns a new list. Tracks with no value for the column always sort last. */
export function sortAuditionTracks(tracks: readonly RekordboxTrack[], sort: AuditionSort | null): RekordboxTrack[] {
  if (!sort) return [...tracks];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const av = sortValue(a, sort.column);
    const bv = sortValue(b, sort.column);
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
