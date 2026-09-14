import {
  rouletteStemAssetRepository,
  type CommitStemReadyPairInput,
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


export interface CommitReadyStemPairInput {
  trackId: string;
  sourceFingerprint: string;
  separatorVersion: string;
  outputs: {
    vocals: {
      locator: string;
      durationMs: number;
      sampleRateHz: number;
      channelCount: number;
      size: number;
      mtimeMs: number;
    };
    instrumental: {
      locator: string;
      durationMs: number;
      sampleRateHz: number;
      channelCount: number;
      size: number;
      mtimeMs: number;
    };
  };
}

export interface StemAssetService {
  getReadiness(
    trackId: string,
    stemType: StemAssetType,
    options?: StemAssetValidationOptions,
  ): Promise<StemAssetReadiness>;
  register(input: RegisterStemAssetInput): Promise<StemAssetRecord>;
  commitReadyPair(input: CommitReadyStemPairInput): Promise<StemAssetRecord[]>;
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
    if (!existing || existing.installation_id == null) return null;
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
    let asset = await repository.getAsset(trackId, stemType);
    if (!asset) return missingReadiness(trackId, stemType);

    const currentSourceFingerprint = await repository.getCurrentSourceFingerprint(trackId);
    const metadataState = isStemAssetMetadataCurrent(asset, currentSourceFingerprint, options);
    if (!metadataState.current) {
      if (asset.installation_id == null) {
        return {
          parentTrackId: trackId,
          stemType,
          status: 'unavailable',
          asset,
          reason: metadataState.message,
        };
      }
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
      if (asset.installation_id == null) {
        return {
          parentTrackId: trackId,
          stemType,
          status: 'unavailable',
          asset,
          reason: 'Ready stem metadata is incomplete.',
        };
      }
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
      return {
        parentTrackId: trackId,
        stemType,
        status: 'unavailable',
        asset,
        reason: notFoundError(inspection.error.kind)
          ? 'Stem file is not available on this installation.'
          : inspection.error.message,
      };
    }

    if (
      (asset.file_size_bytes != null && asset.file_size_bytes !== inspection.asset.size)
      || (asset.file_mtime_ms != null && asset.file_mtime_ms !== inspection.asset.mtimeMs)
    ) {
      return {
        parentTrackId: trackId,
        stemType,
        status: 'unavailable',
        asset,
        reason: 'Stem file changed after it was registered on this installation.',
      };
    }

    if (asset.installation_id == null && repository.claimLegacyAsset) {
      asset = await repository.claimLegacyAsset(asset.id);
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

  const commitReadyPair = async (input: CommitReadyStemPairInput): Promise<StemAssetRecord[]> => {
    const desktop = getDesktopBridge();
    if (!desktop) throw new Error('Ready stem assets can only be committed in the DropDex desktop runtime.');
    const currentSourceFingerprint = await repository.getCurrentSourceFingerprint(input.trackId);
    if (currentSourceFingerprint !== input.sourceFingerprint) {
      throw new Error('Parent track media changed while Roulette stems were being prepared.');
    }
    const [vocalsInspection, instrumentalInspection] = await Promise.all([
      desktop.inspectStemAsset(input.outputs.vocals.locator),
      desktop.inspectStemAsset(input.outputs.instrumental.locator),
    ]);
    if (!vocalsInspection.ok) {
      const failure = vocalsInspection as Extract<typeof vocalsInspection, { ok: false }>;
      throw new Error(failure.error.message);
    }
    if (!instrumentalInspection.ok) {
      const failure = instrumentalInspection as Extract<typeof instrumentalInspection, { ok: false }>;
      throw new Error(failure.error.message);
    }
    if (
      vocalsInspection.asset.size !== input.outputs.vocals.size
      || vocalsInspection.asset.mtimeMs !== input.outputs.vocals.mtimeMs
      || instrumentalInspection.asset.size !== input.outputs.instrumental.size
      || instrumentalInspection.asset.mtimeMs !== input.outputs.instrumental.mtimeMs
    ) {
      throw new Error('Generated stem files changed before the canonical pair commit.');
    }
    if (Math.abs(input.outputs.vocals.durationMs - input.outputs.instrumental.durationMs) > 2) {
      throw new Error('Generated stem durations do not align.');
    }
    if (
      input.outputs.vocals.sampleRateHz !== input.outputs.instrumental.sampleRateHz
      || input.outputs.vocals.channelCount !== input.outputs.instrumental.channelCount
    ) {
      throw new Error('Generated stem sample properties do not align.');
    }
    const pair: CommitStemReadyPairInput = {
      trackId: input.trackId,
      sourceFingerprint: input.sourceFingerprint,
      separatorVersion: input.separatorVersion,
      vocals: {
        locator: input.outputs.vocals.locator,
        durationMs: input.outputs.vocals.durationMs,
        sampleRateHz: input.outputs.vocals.sampleRateHz,
        channelCount: input.outputs.vocals.channelCount,
        fileSizeBytes: input.outputs.vocals.size,
        fileMtimeMs: input.outputs.vocals.mtimeMs,
      },
      instrumental: {
        locator: input.outputs.instrumental.locator,
        durationMs: input.outputs.instrumental.durationMs,
        sampleRateHz: input.outputs.instrumental.sampleRateHz,
        channelCount: input.outputs.instrumental.channelCount,
        fileSizeBytes: input.outputs.instrumental.size,
        fileMtimeMs: input.outputs.instrumental.mtimeMs,
      },
    };
    return repository.commitReadyPair(pair);
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
    if (!existing || existing.installation_id == null) {
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
    if (!resolved.ok) return null;
    if (
      resolved.source.size !== readiness.asset.file_size_bytes
      || resolved.source.mtimeMs !== readiness.asset.file_mtime_ms
    ) return null;
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
    commitReadyPair,
    markFailed,
    resolveReady,
    invalidate,
    delete: deleteAsset,
  };
}

export const rouletteStemAssetService = createStemAssetService();
