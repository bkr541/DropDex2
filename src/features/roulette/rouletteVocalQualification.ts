import { AUTO_CUE_STRATEGY_SETTINGS } from '../../lib/music/autoCueStrategy';
import type { VocalAnalysisRow, VocalRegionRow } from '../../lib/queries/analysisData';

function isFiniteVocalRegion(region: VocalRegionRow): boolean {
  return Number.isFinite(region.start_frame)
    && Number.isFinite(region.end_frame_exclusive)
    && Number.isFinite(region.start_ms)
    && Number.isFinite(region.end_ms)
    && Number.isFinite(region.duration_ms)
    && Number.isFinite(region.peak_confidence)
    && region.start_frame >= 0
    && region.end_frame_exclusive > region.start_frame
    && region.start_ms >= 0
    && region.end_ms > region.start_ms
    && region.duration_ms > 0;
}

/**
 * Return the PVDI regions that are strong enough to prove meaningful vocal
 * material for Roulette. This deliberately reuses DropDex's existing PVDI
 * validity contract and Auto Cue thresholds instead of inventing a second
 * vocal-analysis pipeline.
 */
export function qualifyingRouletteVocalRegions(
  analysis: VocalAnalysisRow | null | undefined,
): VocalRegionRow[] {
  if (
    !analysis
    || analysis.source_tag !== 'PVDI'
    || analysis.integrity_status !== 'valid'
    || !analysis.complete
  ) return [];

  return [...analysis.regions]
    .filter(isFiniteVocalRegion)
    .filter((region) => (
      region.duration_ms >= AUTO_CUE_STRATEGY_SETTINGS.pvdiMinimumRegionMs
      && region.peak_confidence >= AUTO_CUE_STRATEGY_SETTINGS.pvdiStrongThreshold
    ))
    .sort((left, right) => left.start_ms - right.start_ms || left.start_frame - right.start_frame);
}

export function hasQualifyingRouletteVocalMaterial(
  analysis: VocalAnalysisRow | null | undefined,
): boolean {
  return qualifyingRouletteVocalRegions(analysis).length > 0;
}
