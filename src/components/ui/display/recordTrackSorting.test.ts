import { describe, expect, it } from 'vitest';
import { compareRecordValues, nextRecordSort, sortRecordTracks } from './recordTrackSorting';

const tracks = [
  { id: 'ten', title: 'Track 10', artist: 'Zulu', bpm: 140, date_added: '2026-11-06', duration_ms: 120000, genre: 'House', file_format: 'WAV', musical_key: '10B' },
  { id: 'two', title: 'Track 2', artist: 'Alpha', bpm: 95, date_added: '2020-01-01', duration_ms: 30000, genre: 'ambient', file_format: 'MP3', musical_key: '2A' },
  { id: 'missing', title: 'Track 3', artist: null, bpm: null, date_added: null, duration_ms: null, genre: null, file_format: null, musical_key: null },
];
const ids = (column: string, direction: 'asc' | 'desc') => sortRecordTracks(tracks, { column, direction }).map(({ id }) => id);

describe('shared audio record sorting', () => {
  it('starts a new column ascending and keeps alternating directions on repeated clicks', () => {
    const first = nextRecordSort(null, 'bpm');
    expect(first).toEqual({ column: 'bpm', direction: 'asc' });
    const second = nextRecordSort(first, 'bpm');
    expect(second).toEqual({ column: 'bpm', direction: 'desc' });
    expect(nextRecordSort(second, 'bpm')).toEqual(first);
    expect(nextRecordSort(second, 'title')).toEqual({ column: 'title', direction: 'asc' });
  });

  it('orders BPM and duration numerically, and puts missing values last in both directions', () => {
    for (const column of ['bpm', 'length']) {
      expect(ids(column, 'asc')).toEqual(['two', 'ten', 'missing']);
      expect(ids(column, 'desc')).toEqual(['ten', 'two', 'missing']);
    }
  });

  it('sorts text naturally and case-insensitively, including Camelot codes', () => {
    expect(ids('title', 'asc')).toEqual(['two', 'missing', 'ten']);
    for (const column of ['genre', 'artist', 'key', 'format']) {
      expect(ids(column, 'asc')).toEqual(['two', 'ten', 'missing']);
      expect(ids(column, 'desc')).toEqual(['ten', 'two', 'missing']);
    }
  });

  it('sorts Date added chronologically and undated tracks last', () => {
    expect(ids('date-added', 'asc')).toEqual(['two', 'ten', 'missing']);
    expect(ids('date-added', 'desc')).toEqual(['ten', 'two', 'missing']);
  });

  it('sorts actual playlist counts and places unloaded counts last', () => {
    const counts = new Map([['ten', 10], ['two', 2]]);
    expect(sortRecordTracks(tracks, { column: 'playlists', direction: 'asc' }, counts).map(({ id }) => id)).toEqual(['two', 'ten', 'missing']);
    expect(sortRecordTracks(tracks, { column: 'playlists', direction: 'desc' }, counts).map(({ id }) => id)).toEqual(['ten', 'two', 'missing']);
  });

  it('supports metadata getters and preserves input order for equal or missing values without mutating the source', () => {
    expect(sortRecordTracks(tracks, { column: 'metadata', direction: 'asc' }, undefined, (track) => track.id === 'ten' ? 10 : 2).map(({ id }) => id)).toEqual(['two', 'missing', 'ten']);
    expect(sortRecordTracks(tracks, { column: 'metadata', direction: 'desc' }, undefined, () => null)).toEqual(tracks);
    expect(tracks.map(({ id }) => id)).toEqual(['ten', 'two', 'missing']);
    expect(compareRecordValues(0, null, 'desc')).toBeLessThan(0);
    expect(compareRecordValues(NaN, 1, 'asc')).toBeGreaterThan(0);
    expect(compareRecordValues(false, true, 'asc')).toBeLessThan(0);
  });
});
