import type { RouletteEqState } from '../../features/roulette/rouletteAudioRuntime';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import { chooseInitialFlipLabPair, getFlipLabPairRejectionReason } from './flipLabMatching';
import type { FlipLabLoopBars } from './useFlipLabAudioRuntime';

export const FLIP_LAB_SESSION_VERSION = 1;
const STORAGE_PREFIX = 'dropdex:flip-lab-session:v1:';

export interface FlipLabPersistedSession {
  version: typeof FLIP_LAB_SESSION_VERSION;
  importId: string;
  selectedVocalId: string | null;
  selectedInstrumentalId: string | null;
  vocalTab: 'suggested' | 'library';
  instrumentalTab: 'suggested' | 'library';
  syncEnabled: boolean;
  mixPosition: number;
  eq: RouletteEqState;
  loopBars: FlipLabLoopBars;
}

export interface FlipLabRestoredSelection {
  vocalId: string | null;
  instrumentalId: string | null;
  source: 'persisted' | 'fallback' | 'empty';
}

export function createDefaultFlipLabSession(
  importId: string,
  selectedVocalId: string | null = null,
  selectedInstrumentalId: string | null = null,
): FlipLabPersistedSession {
  return {
    version: FLIP_LAB_SESSION_VERSION,
    importId,
    selectedVocalId,
    selectedInstrumentalId,
    vocalTab: 'suggested',
    instrumentalTab: 'suggested',
    syncEnabled: true,
    mixPosition: 0.5,
    eq: {
      vocal: { low: 0, mid: 0, high: 0 },
      instrumental: { low: 0, mid: 0, high: 0 },
    },
    loopBars: 16,
  };
}

function isNullableTrackId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

function isTab(value: unknown): value is 'suggested' | 'library' {
  return value === 'suggested' || value === 'library';
}

function isLoopBars(value: unknown): value is FlipLabLoopBars {
  return value === 'off' || value === 4 || value === 8 || value === 16 || value === 32;
}

function isEqBandValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -12 && value <= 12;
}

function parseEqDeck(value: unknown): { low: number; mid: number; high: number } | null {
  if (!value || typeof value !== 'object') return null;
  const deck = value as Record<string, unknown>;
  if (!isEqBandValue(deck.low) || !isEqBandValue(deck.mid) || !isEqBandValue(deck.high)) return null;
  return { low: deck.low, mid: deck.mid, high: deck.high };
}

export function flipLabSessionStorageKey(importId: string): string {
  return `${STORAGE_PREFIX}${importId}`;
}

export function parseFlipLabSession(raw: string | null, expectedImportId: string): FlipLabPersistedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== FLIP_LAB_SESSION_VERSION || value.importId !== expectedImportId) return null;
    if (!isNullableTrackId(value.selectedVocalId) || !isNullableTrackId(value.selectedInstrumentalId)) return null;
    if (!isTab(value.vocalTab) || !isTab(value.instrumentalTab)) return null;
    if (typeof value.syncEnabled !== 'boolean') return null;
    if (typeof value.mixPosition !== 'number' || !Number.isFinite(value.mixPosition) || value.mixPosition < 0 || value.mixPosition > 1) return null;
    if (!isLoopBars(value.loopBars)) return null;
    if (!value.eq || typeof value.eq !== 'object') return null;
    const eq = value.eq as Record<string, unknown>;
    const vocal = parseEqDeck(eq.vocal);
    const instrumental = parseEqDeck(eq.instrumental);
    if (!vocal || !instrumental) return null;

    return {
      version: FLIP_LAB_SESSION_VERSION,
      importId: expectedImportId,
      selectedVocalId: value.selectedVocalId,
      selectedInstrumentalId: value.selectedInstrumentalId,
      vocalTab: value.vocalTab,
      instrumentalTab: value.instrumentalTab,
      syncEnabled: value.syncEnabled,
      mixPosition: value.mixPosition,
      eq: { vocal, instrumental },
      loopBars: value.loopBars,
    };
  } catch {
    return null;
  }
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadFlipLabSession(importId: string, storage?: Storage | null): FlipLabPersistedSession | null {
  const resolved = resolveStorage(storage);
  if (!resolved) return null;
  try {
    return parseFlipLabSession(resolved.getItem(flipLabSessionStorageKey(importId)), importId);
  } catch {
    return null;
  }
}

export function saveFlipLabSession(session: FlipLabPersistedSession, storage?: Storage | null): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    resolved.setItem(flipLabSessionStorageKey(session.importId), JSON.stringify(session));
  } catch {
    // Persistence must never make Flip Lab unusable (private browsing/quota/etc.).
  }
}

/**
 * Restores only selections that are still present in the role-specific canonical
 * candidate pools. A stored invalid/stale pair falls back to the same canonical
 * initial-pair chooser used by a fresh Flip Lab session. Explicitly cleared roles
 * remain clear instead of being auto-filled.
 */
export function resolveFlipLabRestoredSelection(
  session: FlipLabPersistedSession | null,
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
): FlipLabRestoredSelection {
  const fallback = () => {
    const pair = chooseInitialFlipLabPair(vocals, instrumentals);
    return {
      vocalId: pair?.vocal.track.id ?? null,
      instrumentalId: pair?.instrumental.track.id ?? null,
      source: pair ? 'fallback' as const : 'empty' as const,
    };
  };

  // No prior session at all means a genuinely fresh screen: never auto-select
  // a pair the user hasn't chosen. Fallback ranking is only for recovering a
  // stored selection that has gone stale (handled below).
  if (!session) return { vocalId: null, instrumentalId: null, source: 'empty' };

  const vocal = session.selectedVocalId
    ? vocals.find((candidate) => candidate.track.id === session.selectedVocalId) ?? null
    : null;
  const instrumental = session.selectedInstrumentalId
    ? instrumentals.find((candidate) => candidate.track.id === session.selectedInstrumentalId) ?? null
    : null;

  // A non-null stored ID that disappeared from its role pool is stale or no
  // longer eligible. Never resurrect it from the all-track library.
  if ((session.selectedVocalId && !vocal) || (session.selectedInstrumentalId && !instrumental)) {
    return fallback();
  }

  // Null is meaningful: the user may have deliberately cleared one role.
  if (!vocal || !instrumental) {
    return {
      vocalId: vocal?.track.id ?? null,
      instrumentalId: instrumental?.track.id ?? null,
      source: 'persisted',
    };
  }

  if (vocal.track.id === instrumental.track.id || getFlipLabPairRejectionReason(vocal, instrumental) !== null) {
    return fallback();
  }

  return {
    vocalId: vocal.track.id,
    instrumentalId: instrumental.track.id,
    source: 'persisted',
  };
}
