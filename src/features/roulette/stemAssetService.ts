import {
  rouletteStemAssetRepository,
  type RegisterStemAssetRecordInput,
  type StemAssetRepository,
} from '../../lib/queries/rouletteStemAssets';
import {
  isStemAssetMetadataCurrent,
  rouletteStatusForStem,
  type ResolvedStemMedia,
  type StemAssetReadiness,
  type StemAssetRecord,
  type StemAssetType,
  type StemAssetValidationOptions,
} from './stemAssets';

type DesktopStemBridge = Pick<
  NonNullable<Window['dropdexDesktop']>,
  'inspectStemAsset' | 'resolveStemAsset' | 'deleteStemAsset'
>;

export interface StemAssetServiceDependencies {
  repository: StemAssetRepository;
  getDesktopBridge(): DesktopStemBridge | null;
}

export interface RegisterStemAssetInput {
  trackId: string;
  stemType: StemAssetType;
  status: RegisterStemAssetRecordInput['status'];
  storageLocator?: string | null;
  separatorVersion?: string | null;
  durationMs?: number | null;
  sampleRateHz?: number | null;
  channelCount?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface StemAssetService {
  getReadiness(
    trackId: string,
    stemType: StemAssetType,
    options?: StemAssetValidationOptions,
  ): Promise<StemAssetReadiness>;
  register(input: RegisterStemAssetInput): Promise<StemAssetRecord>;
  markFailed(
    trackId: string,
    stemType: StemAssetType,
    failureCode: string,
    failureMessage: string,
  ): Promise<StemAssetRecord>;
  resolveReady(
    trackId: string,
    stemType: StemAssetType,
    options?: StemAssetValidationOptions,
  ): Promise<ResolvedStemMedia | null>;
  invalidate(
    trackId: string,
    stemType: StemAssetType,
    code: string,
    message: string,
  ): Promise<StemAssetRecord | null>;
  delete(trackId: string, stemType: StemAssetType): Promise<void>;
}

function defaultDesktopBridge(): DesktopStemBridge | null {
  if (typeof window === 'undefined') return null;
  const desktop = window.dropdexDesktop;
  return desktop?.isElectron ? desktop : null;
}

function missingReadiness(trackId: string, stemType: StemAssetType): StemAssetReadiness {
  return {
    parentTrackId: trackId,
    stemType,
    status: 'unavailable',
    asset: null,
    reason: null,
  };
}

function notFoundError(kind: string): boolean {
  return kind === 'not_found' || kind === 'invalid_locator' || kind === 'security';
}

export function createStemAssetService(
  dependencies: StemAssetServiceDependencies = {
    repository: rouletteStemAssetRepository,
    getDesktopBridge: defaultDesktopBridge,
  },
): StemAssetService {
  const { repository, getDesktopBridge } = dependencies;

  const removeLocalAsset = async (asset: StemAssetRecord): Promise<void> => {
    if (!asset.storage_locator) return;
    const desktop = getDesktopBridge();
    if (!desktop) return;
    const result = await desktop.deleteStemAsset(asset.storage_locator);
    if (!result.ok && !notFoundError(result.error.kind)) {
      throw new Error(result.error.message);
    }
  };

  const invalidate = async (
    trackId: string,
    stemType: StemAssetType,
    code: string,
    message: string,
  ): Promise<StemAssetRecord | null> => {
    const existing = await repository.getAsset(trackId, stemType);
    if (!existing) return null;
    await removeLocalAsset(existing);
    const currentSourceFingerprint = await repository.getCurrentSourceFingerprint(trackId);
    return repository.updateStatus(trackId, stemType, 'pending', {
      storage_locator: null,
      separator_version: null,
      duration_ms: null,
      sample_rate_hz: null,
      channel_count: null,
      file_size_bytes: null,
      file_mtime_ms: null,
      failure_code: code,
      failure_message: message,
      source_fingerprint: currentSourceFingerprint,
    });
  };

  const getReadiness = async (
    trackId: string,
    stemType: StemAssetType,
    options: StemAssetValidationOptions = {},
  ): Promise<StemAssetReadiness> => {
    const asset = await repository.getAsset(trackId, stemType);
    if (!asset) return missingReadiness(trackId, stemType);

    const currentSourceFingerprint = await repository.getCurrentSourceFingerprint(trackId);
    const metadataState = isStemAssetMetadataCurrent(asset, currentSourceFingerprint, options);
    if (!metadataState.current) {
      const invalidated = await invalidate(
        trackId,
        stemType,
        metadataState.code,
        metadataState.message,
      );
      return {
        parentTrackId: trackId,
        stemType,
        status: rouletteStatusForStem(invalidated?.status ?? null),
        asset: invalidated,
        reason: metadataState.message,
      };
    }

    if (asset.status !== 'ready') {
      return {
        parentTrackId: trackId,
        stemType,
        status: rouletteStatusForStem(asset.status),
        asset,
        reason: asset.failure_message,
      };
    }

    if (!asset.storage_locator || !asset.separator_version) {
      const invalidated = await invalidate(
        trackId,
        stemType,
        'incomplete_ready_metadata',
        'Ready stem metadata is incomplete.',
      );
      return {
        parentTrackId: trackId,
        stemType,
        status: rouletteStatusForStem(invalidated?.status ?? null),
        asset: invalidated,
        reason: 'Ready stem metadata is incomplete.',
      };
    }

    const desktop = getDesktopBridge();
    if (!desktop) {
      return {
        parentTrackId: trackId,
        stemType,
        status: 'unavailable',
        asset,
        reason: 'Ready stem playback requires the DropDex desktop runtime.',
      };
    }

    const inspection = await desktop.inspectStemAsset(asset.storage_locator);
    if (!inspection.ok) {
      if (notFoundError(inspection.error.kind)) {
        const invalidated = await invalidate(
          trackId,
          stemType,
          'missing_or_unsafe_asset',
          'Stem file is missing or no longer inside managed storage.',
        );
        return {
          parentTrackId: trackId,
          stemType,
          status: rouletteStatusForStem(invalidated?.status ?? null),
          asset: invalidated,
          reason: 'Stem file is missing or no longer inside managed storage.',
        };
      }
      return {
        parentTrackId: trackId,
        stemType,
        status: 'unavailable',
        asset,
        reason: inspection.error.message,
      };
    }

    if (
      (asset.file_size_bytes != null && asset.file_size_bytes !== inspection.asset.size)
      || (asset.file_mtime_ms != null && asset.file_mtime_ms !== inspection.asset.mtimeMs)
    ) {
      const invalidated = await invalidate(
        trackId,
        stemType,
        'asset_fingerprint_mismatch',
        'Stem file changed after it was registered.',
      );
      return {
        parentTrackId: trackId,
        stemType,
        status: rouletteStatusForStem(invalidated?.status ?? null),
        asset: invalidated,
        reason: 'Stem file changed after it was registered.',
      };
    }

    if (asset.file_size_bytes == null || asset.file_mtime_ms == null) {
      const refreshed = await repository.updateStatus(trackId, stemType, 'ready', {
        file_size_bytes: inspection.asset.size,
        file_mtime_ms: inspection.asset.mtimeMs,
        failure_code: null,
        failure_message: null,
      });
      return {
        parentTrackId: trackId,
        stemType,
        status: 'ready',
        asset: refreshed,
        reason: null,
      };
    }

    return {
      parentTrackId: trackId,
      stemType,
      status: 'ready',
      asset,
      reason: null,
    };
  };

  const register = async (input: RegisterStemAssetInput): Promise<StemAssetRecord> => {
    const sourceFingerprint = await repository.getCurrentSourceFingerprint(input.trackId);
    let fileSizeBytes: number | null = null;
    let fileMtimeMs: number | null = null;

    if (input.status === 'ready') {
      if (!input.storageLocator?.trim()) {
        throw new Error('A ready stem asset requires a managed storage locator.');
      }
      if (!input.separatorVersion?.trim()) {
        throw new Error('A ready stem asset requires a separator version.');
      }
      const desktop = getDesktopBridge();
      if (!desktop) {
        throw new Error('Ready stem assets can only be registered in the DropDex desktop runtime.');
      }
      const inspection = await desktop.inspectStemAsset(input.storageLocator);
      if (!inspection.ok) throw new Error(inspection.error.message);
      fileSizeBytes = inspection.asset.size;
      fileMtimeMs = inspection.asset.mtimeMs;
    }

    return repository.upsertAsset({
      trackId: input.trackId,
      stemType: input.stemType,
      status: input.status,
      storageLocator: input.storageLocator ?? null,
      sourceFingerprint,
      separatorVersion: input.separatorVersion ?? null,
      durationMs: input.durationMs ?? null,
      sampleRateHz: input.sampleRateHz ?? null,
      channelCount: input.channelCount ?? null,
      fileSizeBytes,
      fileMtimeMs,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
    });
  };

  const markFailed = async (
    trackId: string,
    stemType: StemAssetType,
    failureCode: string,
    failureMessage: string,
  ): Promise<StemAssetRecord> => {
    const [existing, sourceFingerprint] = await Promise.all([
      repository.getAsset(trackId, stemType),
      repository.getCurrentSourceFingerprint(trackId),
    ]);
    if (!existing) {
      return repository.upsertAsset({
        trackId,
        stemType,
        status: 'failed',
        sourceFingerprint,
        failureCode,
        failureMessage,
      });
    }
    await removeLocalAsset(existing);
    return repository.updateStatus(trackId, stemType, 'failed', {
      storage_locator: null,
      separator_version: null,
      file_size_bytes: null,
      file_mtime_ms: null,
      failure_code: failureCode,
      failure_message: failureMessage,
      source_fingerprint: sourceFingerprint,
    });
  };

  const resolveReady = async (
    trackId: string,
    stemType: StemAssetType,
    options: StemAssetValidationOptions = {},
  ): Promise<ResolvedStemMedia | null> => {
    const readiness = await getReadiness(trackId, stemType, options);
    if (readiness.status !== 'ready' || !readiness.asset?.storage_locator) return null;
    const desktop = getDesktopBridge();
    if (!desktop) return null;
    const resolved = await desktop.resolveStemAsset(readiness.asset.storage_locator);
    if (!resolved.ok) {
      if (notFoundError(resolved.error.kind)) {
        await invalidate(
          trackId,
          stemType,
          'missing_or_unsafe_asset',
          'Stem file is missing or no longer inside managed storage.',
        );
      }
      return null;
    }
    if (
      resolved.source.size !== readiness.asset.file_size_bytes
      || resolved.source.mtimeMs !== readiness.asset.file_mtime_ms
    ) {
      await invalidate(
        trackId,
        stemType,
        'asset_fingerprint_mismatch',
        'Stem file changed after it was registered.',
      );
      return null;
    }
    return { asset: readiness.asset, source: resolved.source };
  };

  const deleteAsset = async (trackId: string, stemType: StemAssetType): Promise<void> => {
    const existing = await repository.getAsset(trackId, stemType);
    if (!existing) return;
    await removeLocalAsset(existing);
    await repository.deleteAsset(trackId, stemType);
  };

  return {
    getReadiness,
    register,
    markFailed,
    resolveReady,
    invalidate,
    delete: deleteAsset,
  };
}

export const rouletteStemAssetService = createStemAssetService();
