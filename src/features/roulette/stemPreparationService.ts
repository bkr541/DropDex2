import type { RekordboxTrack } from '../../types';
import type {
  DesktopRoulettePreparedStem,
  DesktopRouletteStemPreparationResult,
} from '../../types/dropdex-desktop';
import { resolveUsbPath } from '../../lib/rekordbox/usbPathResolver';
import {
  rouletteStemAssetRepository,
  type StemAssetRepository,
} from '../../lib/queries/rouletteStemAssets';
import {
  rouletteStemAssetService,
  type StemAssetService,
} from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION } from './stemAssets';

export { ROULETTE_SEPARATOR_VERSION } from './stemAssets';

export type RouletteStemPreparationStatus = 'ready' | 'failed' | 'cancelled';

export interface RouletteStemPreparationOutcome {
  status: RouletteStemPreparationStatus;
  cached: boolean;
  message: string | null;
}

type DesktopPreparationBridge = Pick<
  NonNullable<Window['dropdexDesktop']>,
  'prepareRouletteStems' | 'cancelRouletteStems' | 'deleteStemAsset'
>;

export interface RouletteStemPreparationDependencies {
  repository: StemAssetRepository;
  stemAssets: Pick<
    StemAssetService,
    'getReadiness' | 'register' | 'markFailed' | 'commitReadyPair'
  >;
  getDesktopBridge(): DesktopPreparationBridge | null;
}

export interface RouletteStemPreparationService {
  prepare(track: RekordboxTrack): Promise<RouletteStemPreparationOutcome>;
  cancel(trackId: string): Promise<boolean>;
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

function conciseSourcePathError(status: string): string {
  switch (status) {
    case 'empty_path':
      return 'This track has no local media path.';
    case 'unsafe_path':
    case 'unsupported_scheme':
    case 'invalid_encoding':
      return 'This track has an unsupported local media path.';
    case 'no_filename':
      return 'This track path does not identify an audio file.';
    case 'volume_mismatch':
      return 'Connect the Rekordbox USB that owns this track.';
    default:
      return 'This track cannot be resolved for local stem preparation.';
  }
}

function asCommitOutput(output: DesktopRoulettePreparedStem) {
  return {
    locator: output.locator,
    durationMs: output.durationMs,
    sampleRateHz: output.sampleRateHz,
    channelCount: output.channelCount,
    size: output.size,
    mtimeMs: output.mtimeMs,
  };
}

export function createRouletteStemPreparationService(
  dependencies: RouletteStemPreparationDependencies = {
    repository: rouletteStemAssetRepository,
    stemAssets: rouletteStemAssetService,
    getDesktopBridge: defaultDesktopBridge,
  },
): RouletteStemPreparationService {
  const { repository, stemAssets, getDesktopBridge } = dependencies;
  const inFlight = new Map<string, Promise<RouletteStemPreparationOutcome>>();

  const markPairFailed = async (trackId: string, code: string, message: string): Promise<void> => {
    await Promise.allSettled([
      stemAssets.markFailed(trackId, 'vocals', code, message),
      stemAssets.markFailed(trackId, 'instrumental', code, message),
    ]);
  };

  const removeUncommittedOutputs = async (
    desktop: DesktopPreparationBridge,
    result: Extract<DesktopRouletteStemPreparationResult, { ok: true }>,
  ): Promise<void> => {
    await Promise.allSettled([
      desktop.deleteStemAsset(result.outputs.vocals.locator),
      desktop.deleteStemAsset(result.outputs.instrumental.locator),
    ]);
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

    const pathResolution = resolveUsbPath(track.file_path);
    if (pathResolution.status !== 'ok') {
      return { status: 'failed', cached: false, message: conciseSourcePathError(pathResolution.status) };
    }

    const sourceFingerprint = await repository.getCurrentSourceFingerprint(track.id);
    const [vocalsReadiness, instrumentalReadiness] = await Promise.all([
      stemAssets.getReadiness(track.id, 'vocals', { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
      stemAssets.getReadiness(track.id, 'instrumental', { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION }),
    ]);
    if (vocalsReadiness.status === 'ready' && instrumentalReadiness.status === 'ready') {
      return { status: 'ready', cached: true, message: null };
    }

    let prepared: Extract<DesktopRouletteStemPreparationResult, { ok: true }> | null = null;
    try {
      await Promise.all([
        stemAssets.register({
          trackId: track.id,
          stemType: 'vocals',
          status: 'pending',
          separatorVersion: ROULETTE_SEPARATOR_VERSION,
        }),
        stemAssets.register({
          trackId: track.id,
          stemType: 'instrumental',
          status: 'pending',
          separatorVersion: ROULETTE_SEPARATOR_VERSION,
        }),
      ]);
      await Promise.all([
        stemAssets.register({
          trackId: track.id,
          stemType: 'vocals',
          status: 'processing',
          separatorVersion: ROULETTE_SEPARATOR_VERSION,
        }),
        stemAssets.register({
          trackId: track.id,
          stemType: 'instrumental',
          status: 'processing',
          separatorVersion: ROULETTE_SEPARATOR_VERSION,
        }),
      ]);

      const result = await desktop.prepareRouletteStems({
        trackId: track.id,
        sourceSegments: pathResolution.segments,
        sourceFingerprint,
        separatorVersion: ROULETTE_SEPARATOR_VERSION,
        expectedDurationMs: durationMsForTrack(track),
      });
      if (!result.ok) {
        const failure = result as Extract<DesktopRouletteStemPreparationResult, { ok: false }>;
        const status = failure.error.kind === 'cancelled' ? 'cancelled' : 'failed';
        await markPairFailed(track.id, failure.error.kind, failure.error.message);
        return { status, cached: false, message: failure.error.message };
      }
      prepared = result;

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
      prepared = null;
      return { status: 'ready', cached: false, message: null };
    } catch (error) {
      if (prepared) await removeUncommittedOutputs(desktop, prepared);
      const message = error instanceof Error ? error.message : String(error);
      await markPairFailed(track.id, 'stem_preparation_failed', message);
      return { status: 'failed', cached: false, message };
    }
  };

  const prepare = (track: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => {
    const existing = inFlight.get(track.id);
    if (existing) return existing;
    const promise = runPrepare(track).finally(() => {
      if (inFlight.get(track.id) === promise) inFlight.delete(track.id);
    });
    inFlight.set(track.id, promise);
    return promise;
  };

  const cancel = async (trackId: string): Promise<boolean> => {
    const desktop = getDesktopBridge();
    if (!desktop) return false;
    const result = await desktop.cancelRouletteStems(trackId);
    return result.ok && result.cancelled;
  };

  return { prepare, cancel };
}

export const rouletteStemPreparationService = createRouletteStemPreparationService();
