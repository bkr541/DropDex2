import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import {
  auditionPositionLabel,
  filterAuditionTracks,
  formatClock,
  nextAuditionSort,
  sortAuditionTracks,
  timeRulerTicks,
} from './auditionTracks';

function track(overrides: Partial<RekordboxTrack>): RekordboxTrack {
  return {
    id: 'track',
    title: 'Track',
    artist: null,
    genre: null,
    musical_key: null,
    bpm: null,
    duration_ms: null,
    duration_seconds: null,
    ...overrides,
  } as RekordboxTrack;
}

describe('filterAuditionTracks', () => {
  const tracks = [
    track({ id: 'a', bpm: 148, musical_key: '4A' }),
    track({ id: 'b', bpm: 150, musical_key: '4A' }),
    track({ id: 'c', bpm: 128.4, musical_key: '9B' }),
    track({ id: 'd', bpm: null, musical_key: null }),
  ];

  it('keeps everything when no filter is set', () => {
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: null }).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by key', () => {
    expect(filterAuditionTracks(tracks, { key: '4A', bpmRange: null }).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('filters by BPM range and drops tracks with no tempo', () => {
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: [140, 149] }).map((t) => t.id)).toEqual(['a']);
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: [120, 129] }).map((t) => t.id)).toEqual(['c']);
  });

  it('includes both range boundaries, respects fractional tempos, and can reset to all tracks', () => {
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: [148, 150] }).map((t) => t.id)).toEqual(['a', 'b']);
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: [128, 128] })).toEqual([]);
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: [128, 129] }).map((t) => t.id)).toEqual(['c']);
    expect(filterAuditionTracks(tracks, { key: '', bpmRange: null })).toHaveLength(4);
  });

  it('combines key and BPM range', () => {
    expect(filterAuditionTracks(tracks, { key: '4A', bpmRange: [150, 150] }).map((t) => t.id)).toEqual(['b']);
  });
});

describe('sortAuditionTracks', () => {
  const tracks = [
    track({ id: 'a', title: 'beta', bpm: 150, duration_ms: 300_000 }),
    track({ id: 'b', title: 'Alpha', bpm: null, duration_ms: 200_000 }),
    track({ id: 'c', title: 'gamma', bpm: 128, duration_ms: null }),
  ];

  it('keeps library order when there is no sort', () => {
    expect(sortAuditionTracks(tracks, null).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts text without regard to case', () => {
    expect(sortAuditionTracks(tracks, { column: 'title', direction: 'asc' }).map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts numbers and always puts missing values last', () => {
    expect(sortAuditionTracks(tracks, { column: 'bpm', direction: 'asc' }).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(sortAuditionTracks(tracks, { column: 'bpm', direction: 'desc' }).map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(sortAuditionTracks(tracks, { column: 'length', direction: 'desc' }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts file metadata with numeric units and keeps missing values last', () => {
    const files = [
      track({ id: 'a', file_format: 'WAV', sample_rate_hz: 44100, bitrate_kbps: 1411 }),
      track({ id: 'b', file_format: 'MP3', sample_rate_hz: 48000, bitrate_kbps: 320 }),
      track({ id: 'c', file_format: null, sample_rate_hz: null, bitrate_kbps: null }),
    ];
    expect(sortAuditionTracks(files, { column: 'format', direction: 'asc' }).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(sortAuditionTracks(files, { column: 'sampleRate', direction: 'asc' }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(sortAuditionTracks(files, { column: 'bitRate', direction: 'desc' }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not change the input list', () => {
    sortAuditionTracks(tracks, { column: 'title', direction: 'desc' });
    expect(tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nextAuditionSort', () => {
  it('cycles ascending, descending, then off', () => {
    const first = nextAuditionSort(null, 'bpm');
    expect(first).toEqual({ column: 'bpm', direction: 'asc' });
    const second = nextAuditionSort(first, 'bpm');
    expect(second).toEqual({ column: 'bpm', direction: 'desc' });
    expect(nextAuditionSort(second, 'bpm')).toBeNull();
  });

  it('starts ascending when a different column is chosen', () => {
    expect(nextAuditionSort({ column: 'bpm', direction: 'desc' }, 'title')).toEqual({ column: 'title', direction: 'asc' });
  });
});

describe('timeRulerTicks', () => {
  it('returns nothing without a usable duration', () => {
    expect(timeRulerTicks(null)).toEqual([]);
    expect(timeRulerTicks(0)).toEqual([]);
    expect(timeRulerTicks(Number.NaN)).toEqual([]);
  });

  it('uses 30-second labels for a six-minute track', () => {
    const ticks = timeRulerTicks(372_000);
    expect(ticks[0]).toEqual({ ms: 0, label: '0:00' });
    expect(ticks[1]).toEqual({ ms: 30_000, label: '0:30' });
    expect(ticks).toHaveLength(13);
  });

  it('uses finer labels for a short track and never exceeds the label cap', () => {
    expect(timeRulerTicks(60_000)[1].ms).toBe(10_000);
    expect(timeRulerTicks(60 * 60_000).length).toBeLessThanOrEqual(30);
  });
});

describe('formatClock and auditionPositionLabel', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(372_900)).toBe('6:12');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('describes a position in the list', () => {
    expect(auditionPositionLabel(13, 387, false)).toBe('14 of 387');
    expect(auditionPositionLabel(13, 387, true)).toBe('14 of 387+');
    expect(auditionPositionLabel(-1, 387, false)).toBeNull();
    expect(auditionPositionLabel(0, 0, false)).toBeNull();
  });
});
