import { describe, expect, it } from 'vitest';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { RekordboxTrack } from '../../types';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import {
  FLIP_LAB_SESSION_VERSION,
  createDefaultFlipLabSession,
  flipLabSessionStorageKey,
  loadFlipLabSession,
  parseFlipLabSession,
  resolveFlipLabRestoredSelection,
  saveFlipLabSession,
  type FlipLabPersistedSession,
} from './flipLabSession';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function track(id: string, bpm = 142, camelot = '9A'): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: 'Bass',
    label: null,
    musical_key: 'Em',
    camelot_key: camelot,
    normalized_key_name: 'E minor',
    key_tonic: null,
    key_mode: null,
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: `/music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function grid(trackId: string): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: 0, bpm: 142, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: 422, bpm: 142, isDownbeat: false },
    ],
    beat_count: 2,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function candidate(id: string, options: { bpm?: number; camelot?: string } = {}): RouletteCandidateAnalysis {
  return {
    track: track(id, options.bpm ?? 142, options.camelot ?? '9A'),
    stemAsset: null,
    beatGrid: grid(id),
    phraseCount: 2,
  };
}

function session(overrides: Partial<FlipLabPersistedSession> = {}): FlipLabPersistedSession {
  return {
    version: FLIP_LAB_SESSION_VERSION,
    importId: 'import-1',
    selectedVocalId: 'vocal-1',
    selectedInstrumentalId: 'inst-1',
    vocalTab: 'suggested',
    instrumentalTab: 'library',
    syncEnabled: false,
    mixPosition: 0.35,
    eq: {
      vocal: { low: -2, mid: 1.5, high: 0 },
      instrumental: { low: 2, mid: -1, high: 0.5 },
    },
    loopBars: 8,
    ...overrides,
  };
}

describe('Flip Lab import-scoped session persistence', () => {
  it('starts a new import with neutral controls instead of leaking the previous import session', () => {
    expect(createDefaultFlipLabSession('import-2', 'vocal-2', 'inst-2')).toEqual({
      version: FLIP_LAB_SESSION_VERSION,
      importId: 'import-2',
      selectedVocalId: 'vocal-2',
      selectedInstrumentalId: 'inst-2',
      vocalTab: 'suggested',
      instrumentalTab: 'suggested',
      syncEnabled: true,
      mixPosition: 0.5,
      eq: {
        vocal: { low: 0, mid: 0, high: 0 },
        instrumental: { low: 0, mid: 0, high: 0 },
      },
      loopBars: 16,
    });
  });

  it('round-trips useful non-sensitive session controls under the active import key', () => {
    const storage = new MemoryStorage();
    const value = session();

    saveFlipLabSession(value, storage);

    expect(storage.getItem(flipLabSessionStorageKey('import-1'))).not.toBeNull();
    expect(loadFlipLabSession('import-1', storage)).toEqual(value);
    expect(loadFlipLabSession('import-2', storage)).toBeNull();
  });

  it('rejects malformed or cross-import state instead of partially trusting it', () => {
    expect(parseFlipLabSession(JSON.stringify(session()), 'import-2')).toBeNull();
    expect(parseFlipLabSession(JSON.stringify({ ...session(), mixPosition: 7 }), 'import-1')).toBeNull();
    expect(parseFlipLabSession(JSON.stringify({ ...session(), loopBars: 3 }), 'import-1')).toBeNull();
  });

  it('restores a still-eligible canonical pair exactly', () => {
    const restored = resolveFlipLabRestoredSelection(
      session(),
      [candidate('vocal-1'), candidate('vocal-2')],
      [candidate('inst-1'), candidate('inst-2')],
    );

    expect(restored).toEqual({ vocalId: 'vocal-1', instrumentalId: 'inst-1', source: 'persisted' });
  });

  it('preserves an intentional cleared role instead of auto-selecting a replacement', () => {
    const restored = resolveFlipLabRestoredSelection(
      session({ selectedVocalId: null, selectedInstrumentalId: 'inst-1' }),
      [candidate('vocal-1')],
      [candidate('inst-1')],
    );

    expect(restored).toEqual({ vocalId: null, instrumentalId: 'inst-1', source: 'persisted' });
  });

  it('falls back to canonical ranking when a stored role is stale or no longer eligible', () => {
    const restored = resolveFlipLabRestoredSelection(
      session({ selectedVocalId: 'removed-vocal' }),
      [candidate('vocal-1', { camelot: '2A' }), candidate('vocal-2', { camelot: '9A' })],
      [candidate('inst-1', { camelot: '9A' })],
    );

    expect(restored).toEqual({ vocalId: 'vocal-2', instrumentalId: 'inst-1', source: 'fallback' });
  });

  it('does not restore a same-parent or canonically rejected pair', () => {
    const sameParent = resolveFlipLabRestoredSelection(
      session({ selectedVocalId: 'same', selectedInstrumentalId: 'same' }),
      [candidate('same'), candidate('vocal-safe')],
      [candidate('same'), candidate('inst-safe')],
    );
    expect(sameParent.source).toBe('fallback');
    expect(sameParent.vocalId).not.toBe(sameParent.instrumentalId);

    const rejected = resolveFlipLabRestoredSelection(
      session({ selectedVocalId: 'vocal-bad', selectedInstrumentalId: 'inst-bad' }),
      [candidate('vocal-bad', { camelot: '2A' }), candidate('vocal-safe', { camelot: '9A' })],
      [candidate('inst-bad', { camelot: '9A' })],
    );
    expect(rejected).toEqual({ vocalId: 'vocal-safe', instrumentalId: 'inst-bad', source: 'fallback' });
  });
});
