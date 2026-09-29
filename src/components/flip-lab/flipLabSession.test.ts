import { describe, expect, it } from 'vitest';
import {
  FLIP_LAB_SESSION_VERSION,
  flipLabSessionStorageKey,
  loadFlipLabSession,
  parseFlipLabSession,
  resolveFlipLabRestoredSelection,
  saveFlipLabSession,
  type FlipLabPersistedSession,
} from './flipLabSession';
import { fixtureCandidate } from './flipLabTestFixtures';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function session(overrides: Partial<FlipLabPersistedSession> = {}): FlipLabPersistedSession {
  return {
    version: FLIP_LAB_SESSION_VERSION,
    importId: 'import-1',
    selectedVocalId: 'vocal-1',
    selectedInstrumentalId: 'inst-1',
    ...overrides,
  };
}

describe('Flip Lab local session', () => {
  it('round-trips selections under the active import key only', () => {
    const storage = new MemoryStorage();
    saveFlipLabSession(session(), storage);
    expect(storage.getItem(flipLabSessionStorageKey('import-1'))).not.toBeNull();
    expect(loadFlipLabSession('import-1', storage)).toEqual(session());
    expect(loadFlipLabSession('import-2', storage)).toBeNull();
  });

  it('ignores older-format or malformed sessions', () => {
    expect(parseFlipLabSession(JSON.stringify({ ...session(), version: 1 }), 'import-1')).toBeNull();
    expect(parseFlipLabSession('not json', 'import-1')).toBeNull();
  });

  it('starts empty on a fresh screen instead of auto-selecting a pair', () => {
    expect(resolveFlipLabRestoredSelection(null, [fixtureCandidate('vocal-1')], [fixtureCandidate('inst-1')]))
      .toEqual({ vocalId: null, instrumentalId: null });
  });

  it('restores only picks that still exist and never substitutes another track', () => {
    expect(resolveFlipLabRestoredSelection(
      session({ selectedVocalId: 'gone' }),
      [fixtureCandidate('vocal-1')],
      [fixtureCandidate('inst-1')],
    )).toEqual({ vocalId: null, instrumentalId: 'inst-1' });
  });
});
