import type { UsbConnectionContextValue } from '../../contexts/UsbConnectionContext';
import { fetchTrackBeatGrid, fetchTrackCues, fetchTrackPhrases } from '../../lib/queries/analysisData';
import { fetchLibraryTracksPage, fetchTracksByIds, type LibraryTrackFilters } from '../../lib/queries/rekordbox';
import { fetchRekordboxRecommendationEdges, type EdgeDirection } from '../../lib/queries/recommendations';
import type { RekordboxTrack } from '../../types';
import { prefilterSetLabTrack, verifySetLabCandidate } from './mediaEligibility';
import type { ResolvedSetLabSection } from './sectionResolver';
import type { SetLabBarCount, SetLabFilters, SetLabScope } from './session';

export type SetLabCandidate = Parameters<typeof verifySetLabCandidate>[0]['track']
  & Pick<RekordboxTrack, 'bpm' | 'camelot_key' | 'genre' | 'label'>
  & { identity: string };

export interface SetLabRecommendation {
  direction: EdgeDirection;
  rating: number | null;
  createdAt: string | null;
}

export type SetLabPreflight =
  | { ok: true; windows: readonly ResolvedSetLabSection[] }
  | { ok: false; explanation: string };

export interface SetLabCandidatePool {
  candidates: readonly SetLabCandidate[];
  tracksById: ReadonlyMap<string, SetLabCandidate>;
  recommendations(trackId: string): Promise<ReadonlyMap<string, SetLabRecommendation>>;
  preflight(track: SetLabCandidate, bars: SetLabBarCount): Promise<SetLabPreflight>;
}

function compact(track: RekordboxTrack, identity: string): SetLabCandidate {
  const {
    id, import_id, title, artist, rekordbox_content_id, master_db_id, master_content_id,
    duration_ms, duration_seconds, file_path, file_path_normalized, file_path_volume,
    bpm, camelot_key, genre, label,
  } = track;
  return {
    id, import_id, title, artist, rekordbox_content_id, master_db_id, master_content_id,
    duration_ms, duration_seconds, file_path, file_path_normalized, file_path_volume,
    bpm, camelot_key, genre, label, identity,
  };
}

const PAGE_SIZE = 500;

export async function visitSetLabLibraryTracks(
  scope: SetLabScope, filters: LibraryTrackFilters, visit: (row: RekordboxTrack) => void, signal?: AbortSignal,
): Promise<void> {
  const seen = new Set<string>();
  let total: number | undefined;
  let offset = 0;
  do {
    signal?.throwIfAborted();
    const page = await fetchLibraryTracksPage(scope.sourceImportId, offset, PAGE_SIZE, filters, signal);
    signal?.throwIfAborted();
    total ??= page.total;
    if (page.offset !== offset || page.total !== total || offset + page.items.length > total
      || (!page.items.length && offset < total)) {
      throw new Error('The active library changed while reading candidates. Retry the library request.');
    }
    for (const row of page.items) {
      if (!row.id || row.import_id !== scope.sourceImportId || seen.has(row.id)) {
        throw new Error('The active library returned duplicate or out-of-scope tracks. Retry the library request.');
      }
      seen.add(row.id);
      visit(row);
    }
    offset += page.items.length;
  } while (offset < total);
}

export async function fetchSetLabRecommendations(scope: SetLabScope, trackId: string, signal?: AbortSignal) {
  const edges = await fetchRekordboxRecommendationEdges(scope.sourceImportId, trackId, { signal, allPages: true });
  signal?.throwIfAborted();
  const result = new Map<string, SetLabRecommendation>();
  for (const { edge, direction, otherTrackId } of edges) {
    if (edge.import_id !== scope.sourceImportId) continue;
    const prior = result.get(otherTrackId);
    if (prior && ((prior.rating ?? 0) > (edge.rating ?? 0)
      || ((prior.rating ?? 0) === (edge.rating ?? 0) && (prior.createdAt ?? '') >= (edge.source_created_at ?? '')))) continue;
    result.set(otherTrackId, { direction, rating: edge.rating, createdAt: edge.source_created_at });
  }
  return result;
}

export async function loadSetLabCandidatePool({
  scope, filters, fixedIds, usb, importDeviceName, signal,
}: {
  scope: SetLabScope;
  filters: SetLabFilters;
  fixedIds: readonly string[];
  usb: Pick<UsbConnectionContextValue, 'status' | 'volumeName' | 'resolveTrackSource'>;
  importDeviceName?: string | null;
  signal?: AbortSignal;
}): Promise<SetLabCandidatePool> {
  const candidates: SetLabCandidate[] = [];
  const tracksById = new Map<string, SetLabCandidate>();
  const genres = new Set(filters.genres);
  const fixed = new Set(fixedIds);
  await visitSetLabLibraryTracks(scope, {
    search: filters.search, genre: genres.size === 1 ? filters.genres[0] : null,
  }, (row) => {
    const check = prefilterSetLabTrack(row, scope);
    if (check.ok === false) throw new Error(check.explanation);
    const matches = (!genres.size || genres.has(row.genre ?? ''))
      && (filters.minBpm == null || (row.bpm != null && row.bpm >= filters.minBpm))
      && (filters.maxBpm == null || (row.bpm != null && row.bpm > 0 && row.bpm <= filters.maxBpm));
    if (matches || fixed.has(row.id)) {
      const track = compact(row, check.trackIdentityKey);
      tracksById.set(track.id, track);
      if (matches) candidates.push(track);
    }
  }, signal);

  const missingFixed = fixedIds.filter((id) => !tracksById.has(id));
  if (missingFixed.length > 0) {
    const rows = await fetchTracksByIds(missingFixed, signal);
    signal?.throwIfAborted();
    for (const row of rows) {
      const check = prefilterSetLabTrack(row, scope);
      if (check.ok && fixed.has(row.id)) tracksById.set(row.id, compact(row, check.trackIdentityKey));
    }
  }

  return {
    candidates,
    tracksById,
    async recommendations(trackId) {
      const edges = await fetchSetLabRecommendations(scope, trackId, signal);
      return new Map([...edges].filter(([id]) => tracksById.has(id)));
    },
    async preflight(track, bars) {
      const beatGrid = await fetchTrackBeatGrid(track.id, signal);
      signal?.throwIfAborted();
      // Optional analysis improves the selection. A missing cue or phrase does
      // not make an otherwise usable track ineligible.
      const [phrases, cues] = beatGrid ? await Promise.all([
        fetchTrackPhrases(track.id, signal).catch(() => []),
        fetchTrackCues(track.id, signal).catch(() => []),
      ]) : [[], []];
      signal?.throwIfAborted();
      const result = await verifySetLabCandidate({
        scope, track, analysis: { beatGrid, phrases, cues }, barCount: bars, importDeviceName, signal,
      }, { usb });
      if (result.ok === true) return { ok: true, windows: result.windows };
      return {
        ok: false,
        explanation: [result.explanation, ...(result.attempts?.map((attempt) => attempt.explanation) ?? [])].join(' '),
      };
    },
  };
}
