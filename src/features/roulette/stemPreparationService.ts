import type { RekordboxTrack } from '../../types';
import type { DesktopRoulettePreparedStem } from '../../types/dropdex-desktop';
import { fetchImportById } from '../../lib/queries/rekordbox';
import {
  rouletteStemAssetRepository,
  type StemAssetRepository,
} from '../../lib/queries/rouletteStemAssets';
import {
  rouletteStemAssetService,
  type StemAssetService,
} from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION, type StemAssetType } from './stemAssets';
import {
  isRecoverableRouletteSourceMediaError,
  resolveRouletteSourceMedia,
} from './rouletteSourceMedia';

export { ROULETTE_SEPARATOR_VERSION } from './stemAssets';

export type RouletteStemPreparationStatus = 'ready' | 'failed' | 'cancelled';

export interface RouletteStemPreparationOutcome {
  status: RouletteStemPreparationStatus;
  cached: boolean;
  message: string | null;
  recoveryAction?: 'reconnect-source';
  requiredVolumeName?: string | null;
  connectedVolumeName?: string | null;
}

export interface RouletteHqPairPreparationOutcome {
  status: 'ready' | 'partial' | 'failed' | 'cancelled';
  vocal: RouletteStemPreparationOutcome;
  instrumental: RouletteStemPreparationOutcome;
}

type DesktopPreparationBridge = Pick<
  NonNullable<Window['dropdexDesktop']>,
  'getRouletteRuntimeHealth' | 'prepareRouletteStems' | 'cancelRouletteStems' | 'reconnectUsb'
>;

export interface RouletteStemPreparationDependencies {
  repository: StemAssetRepository;
  stemAssets: Pick<
    StemAssetService,
    'getReadiness' | 'register' | 'markFailed' | 'commitReadyPair'
  >;
  loadSourceDeviceName(importId: string): Promise<string | null>;
  getDesktopBridge(): DesktopPreparationBridge | null;
}

export interface RouletteStemPreparationService {
  /** Canonical full-track HQ preparation used by Track Detail and Roulette. */
  prepare(track: RekordboxTrack): Promise<RouletteStemPreparationOutcome>;
  /** Stage 5/6 command hook. HQ work is serialized and each parent track commits independently. */
  preparePair(
    vocalTrack: RekordboxTrack,
    instrumentalTrack: RekordboxTrack,
  ): Promise<RouletteHqPairPreparationOutcome>;
  cancel(trackId: string): Promise<boolean>;
  reconnectSource(expectedVolumeName?: string | null): Promise<boolean>;
}

function defaultDesktopBridge(): DesktopPreparationBridge | null {
  if (typeof window === 'undefined') return null;
  return window.dropdexDesktop?.isElectron ? window.dropdexDesktop : null;
}

function durationMsForTrack(track: RekordboxTrack): number | null {
  if (track.duration_ms != null) return Math.max(0, Math.round(track.duration_ms));
  if (track.duration_seconds != null) return Math.max(0, Math.round(track.duration_seconds * 1000));
  return null;
}

function asCommitOutput(output: DesktopRoulettePreparedStem) {
  return {
    locator: output.locator,
    durationMs: output.durationMs,
    sampleRateHz: output.sampleRateHz,
    channelCount: output.channelCount,
    size: output.size,
    mtimeMs: output.mtimeMs,
    metrics: output.metrics,
  };
}

function pairStatus(
  vocal: RouletteStemPreparationOutcome,
  instrumental: RouletteStemPreparationOutcome,
): RouletteHqPairPreparationOutcome['status'] {
  if (vocal.status === 'ready' && instrumental.status === 'ready') return 'ready';
  if (vocal.status === 'ready' || instrumental.status === 'ready') return 'partial';
  if (vocal.status === 'cancelled' || instrumental.status === 'cancelled') return 'cancelled';
  return 'failed';
}

export function createRouletteStemPreparationService(
  dependencies: RouletteStemPreparationDependencies = {
    repository: rouletteStemAssetRepository,
    stemAssets: rouletteStemAssetService,
    loadSourceDeviceName: async (importId) => (await fetchImportById(importId))?.device_name ?? null,
    getDesktopBridge: defaultDesktopBridge,
  },
): RouletteStemPreparationService {
  const { repository, stemAssets, loadSourceDeviceName, getDesktopBridge } = dependencies;
  const inFlight = new Map<string, Promise<RouletteStemPreparationOutcome>>();
  const cancelledBeforeStart = new Set<string>();
  let queueTail: Promise<void> = Promise.resolve();
  let activeTrackId: string | null = null;

  const markMutableFailed = async (
    trackId: string,
    mutableStemTypes: readonly StemAssetType[],
    code: string,
    message: string,
  ): Promise<void> => {
    await Promise.allSettled(
      mutableStemTypes.map((stemType) => stemAssets.markFailed(trackId, stemType, code, message)),
    );
  };

  const runPrepare = async (track: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      return {
        status: 'failed',
        cached: false,
        message: 'Roulette stem preparation requires the DropDex desktop app.',
      };
    }

    const sourceFingerprint = await repository.getCurrentSourceFingerprint(track.id);
    const [vocalsReadiness, instrumentalReadiness] = await Promise.all([
      stemAssets.getReadiness(track.id, 'vocals', { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
      stemAssets.getReadiness(track.id, 'instrumental', { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
    ]);
    if (vocalsReadiness.status === 'ready' && instrumentalReadiness.status === 'ready') {
      return { status: 'ready', cached: true, message: null };
    }

    const sourceDeviceName = await loadSourceDeviceName(track.import_id);
    const sourceMedia = resolveRouletteSourceMedia(track, sourceDeviceName);
    if (sourceMedia.status !== 'ok') {
      return { status: 'failed', cached: false, message: sourceMedia.message };
    }

    // Never overwrite a still-valid ready row with transient processing/failure state.
    // The final per-track RPC atomically replaces both rows only after both files validate.
    const mutableStemTypes: StemAssetType[] = [];
    if (vocalsReadiness.status !== 'ready') mutableStemTypes.push('vocals');
    if (instrumentalReadiness.status !== 'ready') mutableStemTypes.push('instrumental');

    const runtimeHealth = await desktop.getRouletteRuntimeHealth();
    if (!runtimeHealth.available) {
      return {
        status: 'failed',
        cached: false,
        message: runtimeHealth.message,
      };
    }

    try {
      await Promise.all(mutableStemTypes.map((stemType) => stemAssets.register({
        trackId: track.id,
        stemType,
        status: 'pending',
        separatorVersion: ROULETTE_SEPARATOR_VERSION,
      })));
      await Promise.all(mutableStemTypes.map((stemType) => stemAssets.register({
        trackId: track.id,
        stemType,
        status: 'processing',
        separatorVersion: ROULETTE_SEPARATOR_VERSION,
      })));

      const result = await desktop.prepareRouletteStems({
        trackId: track.id,
        sourceSegments: sourceMedia.sourceSegments,
        expectedVolumeName: sourceMedia.expectedVolumeName,
        sourceFingerprint,
        separatorVersion: ROULETTE_SEPARATOR_VERSION,
        expectedDurationMs: durationMsForTrack(track),
      });
      if (!result.ok) {
        const failure = result as Extract<typeof result, { ok: false }>;
        const status = failure.error.kind === 'cancelled' ? 'cancelled' : 'failed';
        await markMutableFailed(track.id, mutableStemTypes, failure.error.kind, failure.error.message);
        if (isRecoverableRouletteSourceMediaError(failure.error.kind)) {
          return {
            status,
            cached: false,
            message: failure.error.kind === 'source_media_mismatch'
              ? 'The connected Rekordbox source does not match this track. Reconnect the correct source media.'
              : 'Reconnect the Rekordbox source media for this track to continue.',
            recoveryAction: 'reconnect-source',
            requiredVolumeName: failure.error.requiredVolumeName ?? sourceMedia.expectedVolumeName,
            connectedVolumeName: failure.error.connectedVolumeName ?? null,
          };
        }
        return { status, cached: false, message: failure.error.message };
      }

      if (result.separatorVersion !== ROULETTE_SEPARATOR_VERSION) {
        throw new Error('The local stem separator returned an unexpected processing version.');
      }
      const currentFingerprint = await repository.getCurrentSourceFingerprint(track.id);
      if (currentFingerprint !== sourceFingerprint) {
        throw new Error('Parent track media changed while Roulette stems were being prepared.');
      }

      await stemAssets.commitReadyPair({
        trackId: track.id,
        sourceFingerprint,
        separatorVersion: ROULETTE_SEPARATOR_VERSION,
        outputs: {
          vocals: asCommitOutput(result.outputs.vocals),
          instrumental: asCommitOutput(result.outputs.instrumental),
        },
      });
      return { status: 'ready', cached: result.cached, message: null };
    } catch (error) {
      // Generated HQ files intentionally remain in managed local storage. A retry can
      // reuse the validated manifest/cache; no partial DB ready records are published.
      const message = error instanceof Error ? error.message : String(error);
      await markMutableFailed(track.id, mutableStemTypes, 'stem_preparation_failed', message);
      return { status: 'failed', cached: false, message };
    }
  };

  const prepare = (track: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => {
    const existing = inFlight.get(track.id);
    if (existing) return existing;

    let promise: Promise<RouletteStemPreparationOutcome>;
    promise = queueTail
      .catch(() => undefined)
      .then(async () => {
        if (cancelledBeforeStart.delete(track.id)) {
          return { status: 'cancelled' as const, cached: false, message: 'Stem preparation was cancelled.' };
        }
        activeTrackId = track.id;
        try {
          return await runPrepare(track);
        } finally {
          if (activeTrackId === track.id) activeTrackId = null;
        }
      })
      .finally(() => {
        cancelledBeforeStart.delete(track.id);
        if (inFlight.get(track.id) === promise) inFlight.delete(track.id);
      });
    inFlight.set(track.id, promise);
    queueTail = promise.then(() => undefined, () => undefined);
    return promise;
  };

  const preparePair = async (
    vocalTrack: RekordboxTrack,
    instrumentalTrack: RekordboxTrack,
  ): Promise<RouletteHqPairPreparationOutcome> => {
    const vocal = await prepare(vocalTrack);
    const instrumental = vocalTrack.id === instrumentalTrack.id
      ? vocal
      : await prepare(instrumentalTrack);
    return { status: pairStatus(vocal, instrumental), vocal, instrumental };
  };

  const cancel = async (trackId: string): Promise<boolean> => {
    const queuedOrActive = inFlight.has(trackId);
    if (queuedOrActive && activeTrackId !== trackId) cancelledBeforeStart.add(trackId);
    const desktop = getDesktopBridge();
    if (!desktop) return queuedOrActive;
    const result = await desktop.cancelRouletteStems(trackId);
    return queuedOrActive || (result.ok && result.cancelled);
  };

  const reconnectSource = async (expectedVolumeName: string | null = null): Promise<boolean> => {
    const desktop = getDesktopBridge();
    if (!desktop) return false;
    const result = await desktop.reconnectUsb(expectedVolumeName);
    return result.reconnected;
  };

  return { prepare, preparePair, cancel, reconnectSource };
}

export const rouletteStemPreparationService = createRouletteStemPreparationService();
