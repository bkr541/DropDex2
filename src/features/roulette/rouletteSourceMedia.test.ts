import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import { resolveRouletteSourceMedia } from './rouletteSourceMedia';

function track(overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: 'track-1',
    import_id: 'import-1',
    rekordbox_content_id: 'content-1',
    title: 'Track One',
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: 'Em',
    camelot_key: '9A',
    normalized_key_name: 'E minor',
    key_tonic: 'E',
    key_mode: 'minor',
    bpm: 142,
    duration_seconds: 120,
    duration_ms: 120_000,
    rating: null,
    comments: null,
    file_path: '/Volumes/USB-A/Contents/Artist/Legacy.wav',
    file_path_normalized: '/Contents/Artist/Current.wav',
    file_path_volume: 'USB-A',
    file_format: 'WAV',
    date_added: null,
    created_at: '2026-09-24T00:00:00Z',
    ...overrides,
  } as RekordboxTrack;
}

describe('Roulette source media resolver', () => {
  it('prefers the normalized current path and derives one source-volume identity', () => {
    const result = resolveRouletteSourceMedia(track(), 'USB-A');

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      sourceField: 'file_path_normalized',
      sourceSegments: ['Contents', 'Artist', 'Current.wav'],
      expectedVolumeName: 'USB-A',
    }));
  });

  it('falls back to the raw Rekordbox path when the normalized path is unusable', () => {
    const result = resolveRouletteSourceMedia(track({
      file_path_normalized: 'https://invalid.example/track.wav',
      file_path: '/Volumes/USB-A/Contents/Artist/Fallback.wav',
    }), null);

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      sourceField: 'file_path',
      sourceSegments: ['Contents', 'Artist', 'Fallback.wav'],
      expectedVolumeName: 'USB-A',
    }));
  });

  it('fails closed when neither current nor legacy source references are safe', () => {
    const result = resolveRouletteSourceMedia(track({
      file_path_normalized: '../../etc/passwd',
      file_path: 'https://invalid.example/track.wav',
      file_path_volume: null,
    }));

    expect(result).toMatchObject({
      status: 'invalid',
      message: 'This track has an unsupported local media path.',
    });
  });
});
