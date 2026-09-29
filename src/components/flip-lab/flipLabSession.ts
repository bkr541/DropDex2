import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';

export const FLIP_LAB_SESSION_VERSION = 2;
const STORAGE_PREFIX = 'dropdex:flip-lab-session:v2:';

/** Stored only in this browser/computer — Flip Lab never saves work to the database. */
export interface FlipLabPersistedSession {
  version: typeof FLIP_LAB_SESSION_VERSION;
  importId: string;
  selectedVocalId: string | null;
  selectedInstrumentalId: string | null;
}

export interface FlipLabRestoredSelection {
  vocalId: string | null;
  instrumentalId: string | null;
}

function isNullableTrackId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

export function flipLabSessionStorageKey(importId: string): string {
  return `${STORAGE_PREFIX}${importId}`;
}

export function parseFlipLabSession(raw: string | null, expectedImportId: string): FlipLabPersistedSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return null;
    if (value.version !== FLIP_LAB_SESSION_VERSION || value.importId !== expectedImportId) return null;
    if (!isNullableTrackId(value.selectedVocalId) || !isNullableTrackId(value.selectedInstrumentalId)) return null;
    return {
      version: FLIP_LAB_SESSION_VERSION,
      importId: expectedImportId,
      selectedVocalId: value.selectedVocalId,
      selectedInstrumentalId: value.selectedInstrumentalId,
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

/** Restores only selections that still exist; never auto-selects a track the user didn't pick. */
export function resolveFlipLabRestoredSelection(
  session: FlipLabPersistedSession | null,
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
): FlipLabRestoredSelection {
  if (!session) return { vocalId: null, instrumentalId: null };
  const vocalId = session.selectedVocalId && vocals.some((c) => c.track.id === session.selectedVocalId)
    ? session.selectedVocalId
    : null;
  const instrumentalId = session.selectedInstrumentalId
    && instrumentals.some((c) => c.track.id === session.selectedInstrumentalId)
    ? session.selectedInstrumentalId
    : null;
  return { vocalId, instrumentalId };
}
