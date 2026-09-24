import type { RekordboxTrack } from '../../types';
import { rankRouletteCandidates, rankRoulettePairsBounded, type RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole, type StemAssetRecord, type StemAssetType } from '../../features/roulette/stemAssets';
import { rouletteStemAssetService } from '../../features/roulette/stemAssetService';
import { getCurrentInstallationId } from '../desktop/installationIdentity';
import { fetchTrackBeatGrids, fetchTracksPhrases, fetchTracksVocalAnalysis } from './analysisData';
import { fetchActiveImport, fetchTracksByIds } from './rekordbox';
import { supabase } from '../supabase';

const STEM_PAGE_SIZE = 500;
const TRACK_PAGE_SIZE = 500;
const READY_STEM_PROBE_LIMIT = 32;

export async function fetchReadyRouletteStemTrackIds(
  stemType: StemAssetType,
  limit = READY_STEM_PROBE_LIMIT,
): Promise<string[]> {
  const assets = await fetchReadyRouletteStemAssets(stemType);
  return assets
    .slice(0, Math.max(1, Math.floor(limit)))
    .map((asset) => asset.track_id);
}

/** @deprecated Stage 2 readiness is musical eligibility, not prepared-stem row counts. */
export async function hasRouletteReadyStemPairCandidates(): Promise<boolean> {
  const result = await fetchRouletteCandidateReadiness();
  return result.available;
}

export async function fetchReadyRouletteStemAssets(
  stemType: StemAssetType,
): Promise<StemAssetRecord[]> {
  const installationId = await getCurrentInstallationId();
  const rowsByTrackId = new Map<string, StemAssetRecord>();
  for (let offset = 0; ; offset += STEM_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('roulette_stem_assets')
      .select('*')
      .eq('stem_type', stemType)
      .eq('status', 'ready')
      .eq('separator_version', ROULETTE_SEPARATOR_VERSION)
      .or(`installation_id.eq.${installationId},installation_id.is.null`)
      .order('track_id', { ascending: true })
      .range(offset, offset + STEM_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as StemAssetRecord[];
    for (const row of rows) {
      const existing = rowsByTrackId.get(row.track_id);
      if (!existing || (existing.installation_id == null && row.installation_id === installationId)) {
        rowsByTrackId.set(row.track_id, row);
      }
    }
    if (rows.length < STEM_PAGE_SIZE) break;
  }

  const candidates = [...rowsByTrackId.values()];
  const locallyReady: StemAssetRecord[] = [];
  const batchSize = 16;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const readiness = await Promise.all(batch.map((asset) => (
      rouletteStemAssetService.getReadiness(asset.track_id, stemType, {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      })
    )));
    for (const state of readiness) {
      if (state.status === 'ready' && state.asset) locallyReady.push(state.asset);
    }
  }
  return locallyReady;
}

export async function fetchRouletteTrack(trackId: string): Promise<RekordboxTrack | null> {
  const [track] = await fetchTracksByIds([trackId]);
  return track ?? null;
}

async function resolveRouletteImportId(importId?: string): Promise<string | null> {
  if (importId) return importId;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const userId = data.session?.user.id;
  if (!userId) return null;
  const activeImport = await fetchActiveImport(userId);
  return activeImport?.id ?? null;
}

async function fetchRouletteImportTracks(importId: string): Promise<RekordboxTrack[]> {
  const tracks: RekordboxTrack[] = [];
  for (let offset = 0; ; offset += TRACK_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rekordbox_tracks')
      .select('*')
      .eq('import_id', importId)
      .order('id', { ascending: true })
      .range(offset, offset + TRACK_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RekordboxTrack[];
    tracks.push(...rows);
    if (rows.length < TRACK_PAGE_SIZE) break;
  }
  return tracks;
}

export async function fetchRouletteCandidateAnalysis(
  role: RouletteSourceRole,
  importId?: string,
): Promise<RouletteCandidateAnalysis[]> {
  const resolvedImportId = await resolveRouletteImportId(importId);
  if (!resolvedImportId) return [];

  const tracks = await fetchRouletteImportTracks(resolvedImportId);
  if (tracks.length === 0) return [];
  const trackIds = tracks.map((track) => track.id);
  const [beatGrids, phrases, vocalAnalysis, readyAssets] = await Promise.all([
    fetchTrackBeatGrids(trackIds),
    fetchTracksPhrases(trackIds),
    fetchTracksVocalAnalysis(trackIds),
    fetchReadyRouletteStemAssets(stemTypeForRole(role)).catch(() => [] as StemAssetRecord[]),
  ]);
  const readyAssetsByTrackId = new Map(readyAssets.map((asset) => [asset.track_id, asset]));

  return tracks.map((track) => {
    const vocal = vocalAnalysis.get(track.id);
    const vocalAnalysisAvailable = vocal?.integrity_status === 'valid' && vocal.complete === true;
    const durationMs = track.duration_ms ?? (track.duration_seconds == null ? null : track.duration_seconds * 1000);
    const vocalDurationMs = vocalAnalysisAvailable
      ? vocal.regions.reduce((sum, region) => sum + Math.max(0, region.duration_ms), 0)
      : null;
    const vocalPresenceScore = vocalDurationMs != null && durationMs && durationMs > 0
      ? Math.max(0, Math.min(1, vocalDurationMs / durationMs))
      : null;
    return {
      track,
      stemAsset: readyAssetsByTrackId.get(track.id) ?? null,
      beatGrid: beatGrids.get(track.id) ?? null,
      phraseCount: phrases.get(track.id)?.length ?? 0,
      vocalAnalysisAvailable,
      vocalPresenceScore,
    };
  });
}

export interface RouletteCandidateReadiness {
  available: boolean;
  importId: string | null;
  vocalCandidateCount: number;
  instrumentalCandidateCount: number;
  compatiblePairCount: number;
  reason: 'no-active-library' | 'no-eligible-pair' | null;
}

export interface RouletteActionAvailability {
  canChangeVocal: boolean;
  canChangeInstrumental: boolean;
  canRouletteBoth: boolean;
}

export interface RouletteAvailabilitySnapshot extends RouletteCandidateReadiness {
  actions: RouletteActionAvailability;
}

const EMPTY_ACTION_AVAILABILITY: RouletteActionAvailability = {
  canChangeVocal: false,
  canChangeInstrumental: false,
  canRouletteBoth: false,
};

export async function fetchRouletteAvailabilitySnapshot(
  currentVocalTrackId?: string | null,
  currentInstrumentalTrackId?: string | null,
  importId?: string,
): Promise<RouletteAvailabilitySnapshot> {
  const resolvedImportId = await resolveRouletteImportId(importId);
  if (!resolvedImportId) {
    return {
      available: false,
      importId: null,
      vocalCandidateCount: 0,
      instrumentalCandidateCount: 0,
      compatiblePairCount: 0,
      reason: 'no-active-library',
      actions: EMPTY_ACTION_AVAILABILITY,
    };
  }

  const [vocals, instrumentals] = await Promise.all([
    fetchRouletteCandidateAnalysis('vocal', resolvedImportId),
    fetchRouletteCandidateAnalysis('instrumental', resolvedImportId),
  ]);
  const pairs = rankRoulettePairsBounded(vocals, instrumentals, { maxPairs: 512 });

  let canChangeVocal = false;
  let canChangeInstrumental = false;
  if (currentInstrumentalTrackId) {
    const reference = instrumentals.find((c) => c.track.id === currentInstrumentalTrackId);
    if (reference) {
      const excluded = new Set<string>([currentInstrumentalTrackId]);
      if (currentVocalTrackId) excluded.add(currentVocalTrackId);
      canChangeVocal = rankRouletteCandidates(
        vocals,
        { track: reference.track, beatGrid: reference.beatGrid },
        'vocal',
        excluded,
      ).length > 0;
    }
  }
  if (currentVocalTrackId) {
    const reference = vocals.find((c) => c.track.id === currentVocalTrackId);
    if (reference) {
      const excluded = new Set<string>([currentVocalTrackId]);
      if (currentInstrumentalTrackId) excluded.add(currentInstrumentalTrackId);
      canChangeInstrumental = rankRouletteCandidates(
        instrumentals,
        { track: reference.track, beatGrid: reference.beatGrid },
        'instrumental',
        excluded,
      ).length > 0;
    }
  }
  const currentPairIds = new Set(
    [currentVocalTrackId, currentInstrumentalTrackId].filter((id): id is string => id != null),
  );
  const canRouletteBoth = pairs.some(
    (pair) =>
      !currentPairIds.has(pair.vocal.track.id)
      || !currentPairIds.has(pair.instrumental.track.id),
  );

  return {
    available: pairs.length > 0,
    importId: resolvedImportId,
    vocalCandidateCount: vocals.length,
    instrumentalCandidateCount: instrumentals.length,
    compatiblePairCount: pairs.length,
    reason: pairs.length > 0 ? null : 'no-eligible-pair',
    actions: { canChangeVocal, canChangeInstrumental, canRouletteBoth },
  };
}

export async function fetchRouletteCandidateReadiness(importId?: string): Promise<RouletteCandidateReadiness> {
  const snapshot = await fetchRouletteAvailabilitySnapshot(null, null, importId);
  const { actions: _actions, ...readiness } = snapshot;
  return readiness;
}
