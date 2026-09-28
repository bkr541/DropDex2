import type { RekordboxTrack } from '../../types';
import { rankRouletteCandidates, rankRoulettePairsBoundedWithMetadata, type RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole, type StemAssetRecord, type StemAssetType } from '../../features/roulette/stemAssets';
import { rouletteStemAssetService } from '../../features/roulette/stemAssetService';
import { hasQualifyingRouletteVocalMaterial } from '../../features/roulette/rouletteVocalQualification';
import { getCurrentInstallationId } from '../desktop/installationIdentity';
import { fetchTrackBeatGridsLightweight, fetchTrackPhraseCounts, fetchTracksVocalAnalysis, type VocalAnalysisRow } from './analysisData';
import { fetchActiveImport, fetchTracksByIds } from './rekordbox';
import { supabase } from '../supabase';

const STEM_PAGE_SIZE = 500;
const STEM_TRACK_CHUNK_SIZE = 100;
const TRACK_PAGE_SIZE = 500;
const READY_STEM_PROBE_LIMIT = 32;

// Candidate browsing intentionally excludes heavy JSON/analysis columns. These
// are the fields used by matching, source resolution, playback preparation, and
// the Flip Lab candidate UI.
export const ROULETTE_CANDIDATE_TRACK_COLUMNS = [
  'id',
  'import_id',
  'rekordbox_content_id',
  'title',
  'artist',
  'genre',
  'label',
  'camelot_key',
  'key_tonic',
  'key_mode',
  'bpm',
  'duration_seconds',
  'duration_ms',
  'file_path',
  'file_path_normalized',
  'file_path_volume',
  'file_name',
  'file_format',
  'file_extension',
  'file_size_bytes',
  'sample_rate_hz',
].join(', ');

export interface RouletteCandidatePools {
  importId: string | null;
  vocals: RouletteCandidateAnalysis[];
  instrumentals: RouletteCandidateAnalysis[];
}

export interface RouletteCandidatePoolOptions {
  signal?: AbortSignal;
  /** Limit work for legacy single-role consumers; omitted means derive both roles. */
  roles?: readonly RouletteSourceRole[];
  /**
   * Keep true for Roulette compatibility. Flip Lab sets this false because its
   * selected/visible lifecycle revalidates local readiness on demand.
   */
  verifyLocalStemReadiness?: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

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

function preferCurrentInstallationAssets(
  rows: StemAssetRecord[],
  installationId: string,
): StemAssetRecord[] {
  const rowsByTrackId = new Map<string, StemAssetRecord>();
  for (const row of rows) {
    const existing = rowsByTrackId.get(row.track_id);
    if (!existing || (existing.installation_id == null && row.installation_id === installationId)) {
      rowsByTrackId.set(row.track_id, row);
    }
  }
  return [...rowsByTrackId.values()];
}

async function fetchReadyRouletteStemAssetMetadata(
  stemType: StemAssetType,
  trackIds?: string[],
  signal?: AbortSignal,
): Promise<StemAssetRecord[]> {
  throwIfAborted(signal);
  const installationId = await getCurrentInstallationId();
  throwIfAborted(signal);

  const fetchPage = async (ids: string[] | null, offset: number): Promise<StemAssetRecord[]> => {
    let query = supabase
      .from('roulette_stem_assets')
      .select('*')
      .eq('stem_type', stemType)
      .eq('status', 'ready')
      .eq('separator_version', ROULETTE_SEPARATOR_VERSION)
      .or(`installation_id.eq.${installationId},installation_id.is.null`)
      .order('track_id', { ascending: true });
    if (ids) query = query.in('track_id', ids);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.range(offset, offset + STEM_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as StemAssetRecord[];
  };

  const rows: StemAssetRecord[] = [];
  const uniqueIds = trackIds ? [...new Set(trackIds)].filter(Boolean) : null;
  if (uniqueIds && uniqueIds.length === 0) return [];

  if (uniqueIds) {
    for (let start = 0; start < uniqueIds.length; start += STEM_TRACK_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(start, start + STEM_TRACK_CHUNK_SIZE);
      for (let offset = 0; ; offset += STEM_PAGE_SIZE) {
        const page = await fetchPage(chunk, offset);
        rows.push(...page);
        if (page.length < STEM_PAGE_SIZE) break;
      }
    }
  } else {
    for (let offset = 0; ; offset += STEM_PAGE_SIZE) {
      const page = await fetchPage(null, offset);
      rows.push(...page);
      if (page.length < STEM_PAGE_SIZE) break;
    }
  }

  throwIfAborted(signal);
  return preferCurrentInstallationAssets(rows, installationId);
}

async function verifyReadyRouletteStemAssets(
  assets: StemAssetRecord[],
  stemType: StemAssetType,
  signal?: AbortSignal,
): Promise<StemAssetRecord[]> {
  const locallyReady: StemAssetRecord[] = [];
  const batchSize = 16;
  for (let offset = 0; offset < assets.length; offset += batchSize) {
    throwIfAborted(signal);
    const batch = assets.slice(offset, offset + batchSize);
    const readiness = await Promise.all(batch.map((asset) => (
      rouletteStemAssetService.getReadiness(asset.track_id, stemType, {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      })
    )));
    for (const state of readiness) {
      if (state.status === 'ready' && state.asset) locallyReady.push(state.asset);
    }
  }
  throwIfAborted(signal);
  return locallyReady;
}

export async function fetchReadyRouletteStemAssets(
  stemType: StemAssetType,
): Promise<StemAssetRecord[]> {
  const candidates = await fetchReadyRouletteStemAssetMetadata(stemType);
  return verifyReadyRouletteStemAssets(candidates, stemType);
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

async function fetchRouletteImportTracks(
  importId: string,
  signal?: AbortSignal,
): Promise<RekordboxTrack[]> {
  const tracks: RekordboxTrack[] = [];
  for (let offset = 0; ; offset += TRACK_PAGE_SIZE) {
    throwIfAborted(signal);
    let query = supabase
      .from('rekordbox_tracks')
      .select(ROULETTE_CANDIDATE_TRACK_COLUMNS)
      .eq('import_id', importId)
      .order('id', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.range(offset, offset + TRACK_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RekordboxTrack[];
    tracks.push(...rows);
    if (rows.length < TRACK_PAGE_SIZE) break;
  }
  throwIfAborted(signal);
  return tracks;
}

function candidateRows(
  tracks: RekordboxTrack[],
  beatGrids: Awaited<ReturnType<typeof fetchTrackBeatGridsLightweight>>,
  phraseCounts: Map<string, number>,
  readyAssets: StemAssetRecord[],
): RouletteCandidateAnalysis[] {
  const readyAssetsByTrackId = new Map(readyAssets.map((asset) => [asset.track_id, asset]));
  return tracks.map((track) => ({
    track,
    stemAsset: readyAssetsByTrackId.get(track.id) ?? null,
    beatGrid: beatGrids.get(track.id) ?? null,
    phraseCount: phraseCounts.get(track.id) ?? 0,
  }));
}

/**
 * Shared candidate-analysis loader for consumers that need both source roles.
 * Common track/beat/phrase metadata is fetched once, then role pools are
 * derived from that base. Detailed phrase rows remain lazy and track-scoped.
 */
export async function fetchRouletteCandidatePools(
  importId?: string,
  options: RouletteCandidatePoolOptions = {},
): Promise<RouletteCandidatePools> {
  const { signal, verifyLocalStemReadiness = true, roles } = options;
  const includeVocal = roles ? roles.includes('vocal') : true;
  const includeInstrumental = roles ? roles.includes('instrumental') : true;
  throwIfAborted(signal);
  const resolvedImportId = await resolveRouletteImportId(importId);
  throwIfAborted(signal);
  if (!resolvedImportId) return { importId: null, vocals: [], instrumentals: [] };
  if (!includeVocal && !includeInstrumental) {
    return { importId: resolvedImportId, vocals: [], instrumentals: [] };
  }

  const tracks = await fetchRouletteImportTracks(resolvedImportId, signal);
  if (tracks.length === 0) {
    return { importId: resolvedImportId, vocals: [], instrumentals: [] };
  }

  const trackIds = tracks.map((track) => track.id);
  let vocalAnalysisByTrackId = new Map<string, VocalAnalysisRow>();
  let beatGrids: Awaited<ReturnType<typeof fetchTrackBeatGridsLightweight>>;
  let phraseCounts: Map<string, number>;

  if (includeInstrumental) {
    const [loadedBeatGrids, loadedPhraseCounts, loadedVocalAnalysis] = await Promise.all([
      fetchTrackBeatGridsLightweight(trackIds, signal),
      fetchTrackPhraseCounts(trackIds, signal),
      includeVocal ? fetchTracksVocalAnalysis(trackIds, signal) : Promise.resolve(new Map()),
    ]);
    beatGrids = loadedBeatGrids;
    phraseCounts = loadedPhraseCounts;
    vocalAnalysisByTrackId = loadedVocalAnalysis;
  } else {
    vocalAnalysisByTrackId = await fetchTracksVocalAnalysis(trackIds, signal);
    throwIfAborted(signal);
    const vocalIds = tracks
      .filter((track) => hasQualifyingRouletteVocalMaterial(vocalAnalysisByTrackId.get(track.id)))
      .map((track) => track.id);
    [beatGrids, phraseCounts] = await Promise.all([
      fetchTrackBeatGridsLightweight(vocalIds, signal),
      fetchTrackPhraseCounts(vocalIds, signal),
    ]);
  }
  throwIfAborted(signal);

  const vocalTracks = includeVocal
    ? tracks.filter((track) => hasQualifyingRouletteVocalMaterial(vocalAnalysisByTrackId.get(track.id)))
    : [];

  const [vocalAssetMetadata, instrumentalAssetMetadata] = await Promise.all([
    includeVocal
      ? fetchReadyRouletteStemAssetMetadata('vocals', vocalTracks.map((track) => track.id), signal)
      : Promise.resolve([] as StemAssetRecord[]),
    includeInstrumental
      ? fetchReadyRouletteStemAssetMetadata('instrumental', trackIds, signal)
      : Promise.resolve([] as StemAssetRecord[]),
  ]);
  throwIfAborted(signal);

  const [vocalAssets, instrumentalAssets] = verifyLocalStemReadiness
    ? await Promise.all([
        includeVocal
          ? verifyReadyRouletteStemAssets(vocalAssetMetadata, 'vocals', signal)
          : Promise.resolve([] as StemAssetRecord[]),
        includeInstrumental
          ? verifyReadyRouletteStemAssets(instrumentalAssetMetadata, 'instrumental', signal)
          : Promise.resolve([] as StemAssetRecord[]),
      ])
    : [vocalAssetMetadata, instrumentalAssetMetadata];

  return {
    importId: resolvedImportId,
    vocals: includeVocal ? candidateRows(vocalTracks, beatGrids, phraseCounts, vocalAssets) : [],
    instrumentals: includeInstrumental ? candidateRows(tracks, beatGrids, phraseCounts, instrumentalAssets) : [],
  };
}

export async function fetchRouletteCandidateAnalysis(
  role: RouletteSourceRole,
  importId?: string,
): Promise<RouletteCandidateAnalysis[]> {
  const pools = await fetchRouletteCandidatePools(importId, { roles: [role] });
  return role === 'vocal' ? pools.vocals : pools.instrumentals;
}

export interface RouletteCandidateReadiness {
  available: boolean;
  importId: string | null;
  vocalCandidateCount: number;
  instrumentalCandidateCount: number;
  compatiblePairCount: number;
  compatiblePairCountIsTruncated: boolean;
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
      compatiblePairCountIsTruncated: false,
      reason: 'no-active-library',
      actions: EMPTY_ACTION_AVAILABILITY,
    };
  }

  const pools = await fetchRouletteCandidatePools(resolvedImportId);
  const vocals = pools.vocals;
  const instrumentals = pools.instrumentals;
  const pairPool = rankRoulettePairsBoundedWithMetadata(vocals, instrumentals, { maxPairs: 512 });
  const pairs = pairPool.pairs;

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
  // Keep UI availability aligned with rouletteMatchingEngine. Roulette Both
  // means both deck identities change, not merely that the pair key differs.
  const canRouletteBoth = pairs.some((pair) => (
    (!currentVocalTrackId || pair.vocal.track.id !== currentVocalTrackId)
    && (!currentInstrumentalTrackId || pair.instrumental.track.id !== currentInstrumentalTrackId)
  ));

  return {
    available: pairs.length > 0,
    importId: resolvedImportId,
    vocalCandidateCount: vocals.length,
    instrumentalCandidateCount: instrumentals.length,
    compatiblePairCount: pairs.length,
    compatiblePairCountIsTruncated: pairPool.isTruncated,
    reason: pairs.length > 0 ? null : 'no-eligible-pair',
    actions: { canChangeVocal, canChangeInstrumental, canRouletteBoth },
  };
}

export async function fetchRouletteCandidateReadiness(importId?: string): Promise<RouletteCandidateReadiness> {
  const snapshot = await fetchRouletteAvailabilitySnapshot(null, null, importId);
  const { actions: _actions, ...readiness } = snapshot;
  return readiness;
}
