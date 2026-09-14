import type { DesktopRoulettePreparedStem } from '../../types/dropdex-desktop';
import type { RouletteAnchorProvenance } from './rouletteAnchors';
import type { RouletteSourceRole } from './rouletteSession';
import type { StemAssetRecord } from './stemAssets';

export const ROULETTE_PREVIEW_ALGORITHM_VERSION = 'demucs-4.0.1-htdemucs-16bar-preview-v1' as const;

export type RoulettePreviewPreparationStatus =
  | 'queued'
  | 'running'
  | 'source-required'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface RoulettePreviewWindow {
  sourceTimeMs: number;
  windowEndMs: number;
  durationMs: number;
  sourceBar: number | null;
  sourceBeatSequence: number | null;
  requestedBars: number;
  provenance: RouletteAnchorProvenance;
}

export type RoulettePreparedAuditionAsset =
  | {
      kind: 'hq';
      role: RouletteSourceRole;
      trackId: string;
      sourceFingerprint: string;
      window: RoulettePreviewWindow;
      asset: StemAssetRecord;
    }
  | {
      kind: 'preview';
      role: RouletteSourceRole;
      trackId: string;
      sourceFingerprint: string;
      algorithmVersion: string;
      window: RoulettePreviewWindow;
      output: DesktopRoulettePreparedStem;
      cached: boolean;
    };

export interface RoulettePreviewPreparationState {
  trackId: string;
  role: RouletteSourceRole;
  status: RoulettePreviewPreparationStatus;
  progress: number | null;
  message: string | null;
  requiredVolumeName: string | null;
  connectedVolumeName: string | null;
  window: RoulettePreviewWindow | null;
  asset: RoulettePreparedAuditionAsset | null;
}

export interface ResolvedRouletteAuditionMedia {
  assetKind: RoulettePreparedAuditionAsset['kind'];
  role: RouletteSourceRole;
  trackId: string;
  window: RoulettePreviewWindow;
  /** Seek position within the resolved media. Preview clips start at zero; HQ stems retain parent timeline time. */
  mediaStartMs: number;
  source: {
    kind: 'url';
    url: string;
    size: number;
    mtimeMs: number;
  };
}

export function previewQueueKey(trackId: string, role: RouletteSourceRole): string {
  return `${trackId}:${role}`;
}
