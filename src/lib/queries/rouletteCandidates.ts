import type { RekordboxTrack } from '../../types';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole, type StemAssetRecord, type StemAssetType } from '../../features/roulette/stemAssets';
import { fetchTrackBeatGrids, fetchTracksPhrases, fetchTracksVocalAnalysis } from './analysisData';
import { fetchTracksByIds } from './rekordbox';
import { supabase } from '../supabase';

const STEM_PAGE_SIZE = 500;

const READY_STEM_PROBE_LIMIT = 32;

export async function fetchReadyRouletteStemTrackIds(
  stemType: StemAssetType,
  limit = READY_STEM_PROBE_LIMIT,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .select('track_id')
    .eq('stem_type', stemType)
    .eq('status', 'ready')
    .eq('separator_version', ROULETTE_SEPARATOR_VERSION)
    .order('track_id', { ascending: true })
    .limit(Math.max(1, Math.floor(limit)));
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => typeof row.track_id === 'string' ? row.track_id.trim() : '')
    .filter(Boolean);
}

export async function hasRouletteReadyStemPairCandidates(): Promise<boolean> {
  const [vocalTrackIds, instrumentalTrackIds] = await Promise.all([
    fetchReadyRouletteStemTrackIds('vocals'),
    fetchReadyRouletteStemTrackIds('instrumental'),
  ]);
  if (vocalTrackIds.length === 0 || instrumentalTrackIds.length === 0) return false;
  const instrumentalIds = new Set(instrumentalTrackIds);
  if (instrumentalIds.size > 1) return true;
  const onlyInstrumental = instrumentalTrackIds[0];
  return vocalTrackIds.some((trackId) => trackId !== onlyInstrumental);
}

export async function fetchReadyRouletteStemAssets(
  stemType: StemAssetType,
): Promise<StemAssetRecord[]> {
  const result: StemAssetRecord[] = [];
  for (let offset = 0; ; offset += STEM_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('roulette_stem_assets')
      .select('*')
      .eq('stem_type', stemType)
      .eq('status', 'ready')
      .eq('separator_version', ROULETTE_SEPARATOR_VERSION)
      .order('track_id', { ascending: true })
      .range(offset, offset + STEM_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as StemAssetRecord[];
    result.push(...rows);
    if (rows.length < STEM_PAGE_SIZE) break;
  }
  return result;
}

export async function fetchRouletteTrack(trackId: string): Promise<RekordboxTrack | null> {
  const [track] = await fetchTracksByIds([trackId]);
  return track ?? null;
}

export async function fetchRouletteCandidateAnalysis(
  role: RouletteSourceRole,
): Promise<RouletteCandidateAnalysis[]> {
  const assets = await fetchReadyRouletteStemAssets(stemTypeForRole(role));
  if (assets.length === 0) return [];

  const trackIds = assets.map((asset) => asset.track_id);
  const [tracks, beatGrids, phrases, vocalAnalysis] = await Promise.all([
    fetchTracksByIds(trackIds),
    fetchTrackBeatGrids(trackIds),
    fetchTracksPhrases(trackIds),
    fetchTracksVocalAnalysis(trackIds),
  ]);
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const assetsByTrackId = new Map(assets.map((asset) => [asset.track_id, asset]));

  return trackIds.flatMap((trackId) => {
    const track = tracksById.get(trackId);
    const stemAsset = assetsByTrackId.get(trackId);
    if (!track || !stemAsset) return [];
    return [{
      track,
      stemAsset,
      beatGrid: beatGrids.get(trackId) ?? null,
      phraseCount: phrases.get(trackId)?.length ?? 0,
      vocalAnalysisAvailable: vocalAnalysis.get(trackId)?.integrity_status === 'valid'
        && vocalAnalysis.get(trackId)?.complete === true,
    }];
  });
}
