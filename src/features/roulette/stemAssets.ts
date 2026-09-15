import type { RekordboxTrack } from '../../types';
import type { RouletteSourceRole, RouletteStemStatus } from './rouletteSession';
import type { StemAudioMetrics } from './rouletteStemMetrics';

export const STEM_ASSET_CONTRACT_VERSION = 1 as const;
export const ROULETTE_SEPARATOR_VERSION = 'demucs-4.0.1-htdemucs-two-stem-v1' as const;

export type StemAssetType = 'vocals' | 'instrumental';
export type StemAssetProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface StemAssetRecord {
  id: string;
  track_id: string;
  stem_type: StemAssetType;
  installation_id: string | null;
  status: StemAssetProcessingStatus;
  storage_locator: string | null;
  source_fingerprint: string;
  separator_version: string | null;
  contract_version: number;
  duration_ms: number | null;
  sample_rate_hz: number | null;
  channel_count: number | null;
  file_size_bytes: number | null;
  file_mtime_ms: number | null;
  analysis_metrics: StemAudioMetrics | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface StemAssetReadiness {
  parentTrackId: string;
  stemType: StemAssetType;
  status: RouletteStemStatus;
  asset: StemAssetRecord | null;
  reason: string | null;
}

export interface ResolvedStemMedia {
  asset: StemAssetRecord;
  source: {
    kind: 'url';
    url: string;
    size: number;
    mtimeMs: number;
  };
}

export interface StemAssetValidationOptions {
  expectedSeparatorVersion?: string | null;
}

export function stemTypeForRole(role: RouletteSourceRole): StemAssetType {
  return role === 'vocal' ? 'vocals' : 'instrumental';
}

export function rouletteStatusForStem(status: StemAssetProcessingStatus | null): RouletteStemStatus {
  switch (status) {
    case 'pending':
    case 'processing':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    default:
      return 'unavailable';
  }
}

function normalizedPath(track: Pick<RekordboxTrack, 'file_path_normalized' | 'file_path'>): string {
  return (track.file_path_normalized ?? track.file_path ?? '').trim();
}

/**
 * Stable invalidation identity for the parent media represented by a Rekordbox row.
 * It deliberately uses only durable parent-track media fields and does not duplicate
 * musical metadata such as BPM/key/beat-grid data into the stem asset record.
 */
export function buildParentTrackSourceFingerprint(
  track: Pick<
    RekordboxTrack,
    | 'rekordbox_content_id'
    | 'file_path'
    | 'file_path_normalized'
    | 'file_size_bytes'
    | 'duration_ms'
    | 'duration_seconds'
    | 'sample_rate_hz'
  >,
): string {
  const durationMs = track.duration_ms ?? (
    track.duration_seconds == null ? null : Math.round(track.duration_seconds * 1000)
  );
  return `rekordbox-source-v1:${JSON.stringify([
    track.rekordbox_content_id,
    normalizedPath(track),
    track.file_size_bytes ?? null,
    durationMs,
    track.sample_rate_hz ?? null,
  ])}`;
}

export function isStemAssetMetadataCurrent(
  asset: StemAssetRecord,
  currentSourceFingerprint: string,
  options: StemAssetValidationOptions = {},
): { current: true } | { current: false; code: string; message: string } {
  if (asset.contract_version !== STEM_ASSET_CONTRACT_VERSION) {
    return {
      current: false,
      code: 'contract_version_mismatch',
      message: 'Stem asset contract version is stale.',
    };
  }
  if (asset.source_fingerprint !== currentSourceFingerprint) {
    return {
      current: false,
      code: 'source_fingerprint_mismatch',
      message: 'Parent track media changed after this stem was created.',
    };
  }
  if (
    options.expectedSeparatorVersion
    && asset.separator_version !== options.expectedSeparatorVersion
  ) {
    return {
      current: false,
      code: 'separator_version_mismatch',
      message: 'Stem asset was created by an unsupported separator version.',
    };
  }
  return { current: true };
}
