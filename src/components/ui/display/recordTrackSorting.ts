import type { RekordboxTrack } from '../../../types';
import { durationMsForTrack } from '../../../lib/music/trackTiming';
import { formatCamelotCode } from './camelotKey';
import type { TrackTableSort } from './TrackTable';

export type RecordSortValue = string | number | boolean | null | undefined;
export type SortableRecordTrack = Pick<RekordboxTrack, 'id' | 'title' | 'artist'> &
  Partial<Pick<RekordboxTrack, 'bpm' | 'musical_key' | 'camelot_key' | 'genre' | 'file_format' | 'date_added' | 'duration_ms' | 'duration_seconds' | 'sample_rate_hz' | 'bitrate_kbps'>>;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function nextRecordSort<K extends string>(current: TrackTableSort<K> | null | undefined, column: K): TrackTableSort<K> {
  return { column, direction: current?.column === column && current.direction === 'asc' ? 'desc' : 'asc' };
}

/** Missing values stay last in either direction; numeric fields never sort as formatted strings. */
export function compareRecordValues(left: RecordSortValue, right: RecordSortValue, direction: 'asc' | 'desc') {
  const missing = (value: RecordSortValue) => value == null || (typeof value === 'string' && !value.trim()) || (typeof value === 'number' && !Number.isFinite(value));
  if (missing(left) || missing(right)) return missing(left) ? Number(!missing(right)) : -1;
  const comparison = typeof left === 'number' && typeof right === 'number' ? left - right
    : typeof left === 'boolean' && typeof right === 'boolean' ? Number(left) - Number(right)
      : collator.compare(String(left), String(right));
  return comparison * (direction === 'asc' ? 1 : -1);
}

function recordValue(track: SortableRecordTrack, column: string, counts?: ReadonlyMap<string, number>): RecordSortValue {
  switch (column) {
    case 'title': return track.title;
    case 'artist': return track.artist;
    case 'bpm': return track.bpm;
    case 'key': return formatCamelotCode(track.camelot_key || track.musical_key);
    case 'genre': return track.genre;
    case 'format': return track.file_format;
    case 'playlists': return counts?.get(track.id);
    case 'date-added': return track.date_added;
    case 'length': return durationMsForTrack({ duration_ms: track.duration_ms, duration_seconds: track.duration_seconds ?? null }, null);
    case 'sampleRate': return track.sample_rate_hz && track.sample_rate_hz > 0 ? track.sample_rate_hz : null;
    case 'bitRate': return track.bitrate_kbps && track.bitrate_kbps > 0 ? track.bitrate_kbps : null;
    default: return null;
  }
}

export function sortRecordTracks<T extends SortableRecordTrack>(tracks: readonly T[], sort: TrackTableSort | null | undefined,
  counts?: ReadonlyMap<string, number>, extraValue?: (track: T) => RecordSortValue): T[] {
  if (!sort) return [...tracks];
  return tracks.map((track, index) => ({ track, index })).sort((a, b) =>
    compareRecordValues(extraValue ? extraValue(a.track) : recordValue(a.track, sort.column, counts),
      extraValue ? extraValue(b.track) : recordValue(b.track, sort.column, counts), sort.direction) || a.index - b.index,
  ).map(({ track }) => track);
}
