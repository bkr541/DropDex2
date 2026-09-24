import type { RekordboxTrack } from '../../types';
import type {
  DesktopRoulettePreviewPreparationInput,
  DesktopRoulettePreviewPreparationResult,
} from '../../types/dropdex-desktop';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import {
  fetchTrackBeatGrid,
  fetchTrackPhrases,
  fetchTrackVocalAnalysis,
  type BeatGridRow,
  type PhraseRow,
  type VocalAnalysisRow,
} from '../../lib/queries/analysisData';
import { resolveUsbPath } from '../../lib/rekordbox/usbPathResolver';
import { fetchImportById } from '../../lib/queries/rekordbox';
import {
  rouletteStemAssetRepository,
  type StemAssetRepository,
} from '../../lib/queries/rouletteStemAssets';
import { resolveRouletteMusicalAnchor } from './rouletteAnchors';
import {
  rouletteStemAssetService,
  type StemAssetService,
} from './stemAssetService';
import {
  ROULETTE_SEPARATOR_VERSION,
  stemTypeForRole,
} from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';
import {
  previewQueueKey,
  ROULETTE_PREVIEW_ALGORITHM_VERSION,
  type ResolvedRouletteAuditionMedia,
  type RoulettePreparedAuditionAsset,
  type RoulettePreviewPreparationState,
  type RoulettePreviewRecoveryAction,
  type RoulettePreviewWindow,
} from './roulettePreview';

type DesktopPreviewBridge = Pick<
  NonNullable<Window['dropdexDesktop']>,
  | 'prepareRoulettePreview'
  | 'cancelRouletteStems'
  | 'resolveStemAsset'
  | 'reconnectUsb'
>;

export interface RoulettePreviewPreparationDependencies {
  repository: StemAssetRepository;
  stemAssets: Pick<StemAssetService, 'getReadiness' | 'resolveReady'>;
  loadBeatGrid(trackId: string): Promise<BeatGridRow | null>;
  loadPhrases(trackId: string): Promise<PhraseRow[]>;
  loadVocalAnalysis(trackId: string): Promise<VocalAnalysisRow | null>;
  loadSourceDeviceName(importId: string): Promise<string | null>;
  getDesktopBridge(): DesktopPreviewBridge | null;
}

interface PreviewJob {
  key: string;
  track: RekordboxTrack;
  role: RouletteSourceRole;
  sourceFingerprint: string;
  sourceSegments: string[];
  expectedVolumeName: string | null;
  window: RoulettePreviewWindow;
  resolve: (state: RoulettePreviewPreparationState) => void;
  promise: Promise<RoulettePreviewPreparationState>;
  cancelled: boolean;
}

export interface RoulettePreviewPreparationService {
  prepare(track: RekordboxTrack, role: RouletteSourceRole): Promise<RoulettePreviewPreparationState>;
  getState(trackId: string, role: RouletteSourceRole): RoulettePreviewPreparationState | null;
  subscribe(listener: (state: RoulettePreviewPreparationState) => void): () => void;
  cancel(trackId: string, role?: RouletteSourceRole): Promise<boolean>;
  retry(trackId: string, role: RouletteSourceRole): Promise<RoulettePreviewPreparationState | null>;
  resumeSourceRequired(): Promise<void>;
  reconnectAndResume(trackId: string, role: RouletteSourceRole): Promise<boolean>;
  resolvePreparedAsset(asset: RoulettePreparedAuditionAsset): Promise<ResolvedRouletteAuditionMedia | null>;
}

function defaultDesktopBridge(): DesktopPreviewBridge | null {
  if (typeof window === 'undefined') return null;
  return window.dropdexDesktop?.isElectron ? window.dropdexDesktop : null;
}

function durationMsForTrack(track: RekordboxTrack): number | null {
  if (track.duration_ms != null) return Math.max(0, Math.round(track.duration_ms));
  if (track.duration_seconds != null) return Math.max(0, Math.round(track.duration_seconds * 1000));
  return null;
}

function expectedVolumeName(
  track: RekordboxTrack,
  sourceDeviceName: string | null,
  strippedVolume: string | null,
): string | null {
  const importDevice = sourceDeviceName?.trim() ?? '';
  if (importDevice) return importDevice;
  const stored = track.file_path_volume?.trim() ?? '';
  if (stored) return stored;
  return strippedVolume?.trim() || null;
}


function initialState(
  trackId: string,
  role: RouletteSourceRole,
  status: RoulettePreviewPreparationState['status'],
  window: RoulettePreviewWindow | null,
  message: string | null = null,
  recoveryAction: RoulettePreviewRecoveryAction = 'none',
): RoulettePreviewPreparationState {
  return {
    trackId,
    role,
    status,
    progress: status === 'queued' ? 0 : status === 'running' ? null : status === 'ready' ? 1 : null,
    message,
    recoveryAction,
    requiredVolumeName: null,
    connectedVolumeName: null,
    window,
    asset: null,
  };
}

function previewWindowFromAnchor(anchor: NonNullable<ReturnType<typeof resolveRouletteMusicalAnchor>>): RoulettePreviewWindow {
  return {
    sourceTimeMs: Math.round(anchor.sourceTimeMs),
    windowEndMs: Math.round(anchor.windowEndMs),
    durationMs: Math.round(anchor.windowEndMs - anchor.sourceTimeMs),
    sourceBar: anchor.sourceBar,
    sourceBeatSequence: anchor.sourceBeatSequence,
    requestedBars: anchor.requestedBars,
    provenance: anchor.provenance,
  };
}

function outputForRole(
  role: RouletteSourceRole,
  result: Extract<DesktopRoulettePreviewPreparationResult, { ok: true }>,
) {
  return role === 'vocal' ? result.outputs.vocals : result.outputs.instrumental;
}

export function roulettePreviewFailurePresentation(
  kind: Extract<DesktopRoulettePreviewPreparationResult, { ok: false }>['error']['kind'],
): {
  status: Extract<RoulettePreviewPreparationState['status'], 'failed' | 'cancelled' | 'source-required'>;
  message: string;
  recoveryAction: RoulettePreviewRecoveryAction;
} {
  switch (kind) {
    case 'cancelled':
      return { status: 'cancelled', message: 'Preview preparation was cancelled. Try again when you are ready.', recoveryAction: 'retry' };
    case 'source_media_required':
      return { status: 'source-required', message: 'Reconnect the Rekordbox source media for this track to continue.', recoveryAction: 'reconnect-source' };
    case 'source_media_mismatch':
      return { status: 'source-required', message: 'The connected Rekordbox source does not match this track. Reconnect the correct source media.', recoveryAction: 'reconnect-source' };
    case 'not_found':
    case 'permission_denied':
      return { status: 'source-required', message: 'The track source media is unavailable. Reconnect the original Rekordbox source media.', recoveryAction: 'reconnect-source' };
    case 'runtime_unavailable':
      return { status: 'failed', message: 'Roulette audio runtime setup is required before previews can be prepared. Repair or reinstall the local Roulette runtime, then reopen Roulette.', recoveryAction: 'runtime-setup' };
    case 'processing_failed':
      return { status: 'failed', message: 'Preview preparation failed. Try again.', recoveryAction: 'retry' };
    case 'source_changed':
      return { status: 'failed', message: 'The track media changed during preview preparation. Try again.', recoveryAction: 'retry' };
    case 'unexpected':
      return { status: 'failed', message: 'Preview preparation hit a temporary error. Try again.', recoveryAction: 'retry' };
    case 'security':
    case 'type_mismatch':
    case 'validation_failed':
      return { status: 'failed', message: 'This track cannot be prepared for Roulette with its current local media.', recoveryAction: 'none' };
  }
}

export function createRoulettePreviewPreparationService(
  dependencies: RoulettePreviewPreparationDependencies = {
    repository: rouletteStemAssetRepository,
    stemAssets: rouletteStemAssetService,
    loadBeatGrid: fetchTrackBeatGrid,
    loadPhrases: fetchTrackPhrases,
    loadVocalAnalysis: fetchTrackVocalAnalysis,
    loadSourceDeviceName: async (importId) => (await fetchImportById(importId))?.device_name ?? null,
    getDesktopBridge: defaultDesktopBridge,
  },
): RoulettePreviewPreparationService {
  const states = new Map<string, RoulettePreviewPreparationState>();
  const requests = new Map<string, Promise<RoulettePreviewPreparationState>>();
  const knownJobs = new Map<string, PreviewJob>();
  const listeners = new Set<(state: RoulettePreviewPreparationState) => void>();
  const queue: PreviewJob[] = [];
  let active: PreviewJob | null = null;

  const publish = (state: RoulettePreviewPreparationState) => {
    states.set(previewQueueKey(state.trackId, state.role), state);
    for (const listener of listeners) listener(state);
    return state;
  };

  const finish = (job: PreviewJob, state: RoulettePreviewPreparationState) => {
    publish(state);
    knownJobs.set(job.key, job);
    job.resolve(state);
  };

  const runJob = async (job: PreviewJob): Promise<RoulettePreviewPreparationState> => {
    if (job.cancelled) return initialState(job.track.id, job.role, 'cancelled', job.window, 'Preview preparation was cancelled. Try again when you are ready.', 'retry');
    const desktop = dependencies.getDesktopBridge();
    if (!desktop) {
      return initialState(job.track.id, job.role, 'failed', job.window, 'Roulette preview preparation requires the DropDex desktop app.', 'runtime-setup');
    }

    publish(initialState(job.track.id, job.role, 'running', job.window));
    if (job.cancelled) return initialState(job.track.id, job.role, 'cancelled', job.window, 'Preview preparation was cancelled. Try again when you are ready.', 'retry');

    const input: DesktopRoulettePreviewPreparationInput = {
      trackId: job.track.id,
      role: job.role,
      sourceSegments: job.sourceSegments,
      sourceFingerprint: job.sourceFingerprint,
      algorithmVersion: ROULETTE_PREVIEW_ALGORITHM_VERSION,
      windowStartMs: job.window.sourceTimeMs,
      windowEndMs: job.window.windowEndMs,
      expectedVolumeName: job.expectedVolumeName,
    };
    const result = await desktop.prepareRoulettePreview(input);
    if (!result.ok) {
      const failure = result as Extract<DesktopRoulettePreviewPreparationResult, { ok: false }>;
      const presentation = roulettePreviewFailurePresentation(failure.error.kind);
      const failedState = initialState(
        job.track.id,
        job.role,
        presentation.status,
        job.window,
        presentation.message,
        presentation.recoveryAction,
      );
      return presentation.recoveryAction === 'reconnect-source'
        ? {
            ...failedState,
            requiredVolumeName: failure.error.requiredVolumeName ?? job.expectedVolumeName,
            connectedVolumeName: failure.error.connectedVolumeName ?? null,
          }
        : failedState;
    }

    const currentFingerprint = await dependencies.repository.getCurrentSourceFingerprint(job.track.id);
    if (currentFingerprint !== job.sourceFingerprint) {
      return initialState(
        job.track.id,
        job.role,
        'failed',
        job.window,
        'The track media changed during preview preparation. Try again.',
        'retry',
      );
    }
    const asset: RoulettePreparedAuditionAsset = {
      kind: 'preview',
      role: job.role,
      trackId: job.track.id,
      sourceFingerprint: job.sourceFingerprint,
      algorithmVersion: result.algorithmVersion,
      window: job.window,
      output: outputForRole(job.role, result),
      cached: result.cached,
    };
    return { ...initialState(job.track.id, job.role, 'ready', job.window), asset };
  };

  const pump = () => {
    if (active) return;
    const job = queue.shift();
    if (!job) return;
    active = job;
    void runJob(job)
      .then((state) => finish(job, state))
      .catch(() => finish(job, initialState(
        job.track.id,
        job.role,
        'failed',
        job.window,
        'Preview preparation hit a temporary error. Try again.',
        'retry',
      )))
      .finally(() => {
        if (active === job) active = null;
        requests.delete(job.key);
        pump();
      });
  };

  const enqueue = (job: PreviewJob) => {
    knownJobs.set(job.key, job);
    queue.push(job);
    publish(initialState(job.track.id, job.role, 'queued', job.window));
    pump();
  };

  const prepare = async (track: RekordboxTrack, role: RouletteSourceRole): Promise<RoulettePreviewPreparationState> => {
    const key = previewQueueKey(track.id, role);
    const existing = requests.get(key);
    if (existing) return existing;

    const request = (async () => {
      const desktop = dependencies.getDesktopBridge();
      if (!desktop) return publish(initialState(track.id, role, 'failed', null, 'Roulette preview preparation requires the DropDex desktop app.', 'runtime-setup'));

      const sourceFingerprint = await dependencies.repository.getCurrentSourceFingerprint(track.id);
      const stemType = stemTypeForRole(role);
      const hq = await dependencies.stemAssets.getReadiness(track.id, stemType, {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      });

      const [beatGrid, phrases, vocalAnalysis, sourceDeviceName] = await Promise.all([
        dependencies.loadBeatGrid(track.id),
        dependencies.loadPhrases(track.id),
        role === 'vocal' ? dependencies.loadVocalAnalysis(track.id) : Promise.resolve(null),
        dependencies.loadSourceDeviceName(track.import_id),
      ]);
      if (!beatGrid || beatGrid.is_variable_tempo === true || !isUsableBeatGrid(beatGrid.beats)) {
        return publish(initialState(
          track.id,
          role,
          'failed',
          null,
          beatGrid?.is_variable_tempo === true
            ? 'Variable-tempo tracks are not eligible for Roulette preview preparation.'
            : 'A usable Rekordbox beat grid is required for Roulette preview preparation.',
        ));
      }

      const anchor = resolveRouletteMusicalAnchor({
        role,
        track,
        beatGrid,
        phrases,
        vocalAnalysis,
        durationMs: durationMsForTrack(track),
        stemMetrics: hq.asset?.analysis_metrics ?? null,
      });
      if (!anchor || anchor.provenance === 'bpm-fallback') {
        return publish(initialState(track.id, role, 'failed', null, 'A complete 16-bar beat-grid window is required for Roulette preview preparation.'));
      }
      const window = previewWindowFromAnchor(anchor);

      if (hq.status === 'ready' && hq.asset) {
        const asset: RoulettePreparedAuditionAsset = {
          kind: 'hq',
          role,
          trackId: track.id,
          sourceFingerprint,
          window,
          asset: hq.asset,
        };
        return publish({ ...initialState(track.id, role, 'ready', window), asset });
      }

      const expectedVolume = expectedVolumeName(track, sourceDeviceName, null);
      const pathResolution = resolveUsbPath(
        track.file_path ?? track.file_path_normalized,
        expectedVolume ? { expectedVolume } : {},
      );
      if (pathResolution.status === 'volume_mismatch') {
        return publish(initialState(
          track.id,
          role,
          'failed',
          window,
          "This track's stored source location does not match its Rekordbox source media.",
        ));
      }
      if (pathResolution.status !== 'ok') {
        return publish(initialState(track.id, role, 'failed', window, 'This track does not have a safe local Rekordbox source path.'));
      }

      let resolveJob!: (state: RoulettePreviewPreparationState) => void;
      const promise = new Promise<RoulettePreviewPreparationState>((resolve) => { resolveJob = resolve; });
      const job: PreviewJob = {
        key,
        track,
        role,
        sourceFingerprint,
        sourceSegments: pathResolution.segments,
        expectedVolumeName: expectedVolumeName(track, sourceDeviceName, pathResolution.strippedVolume),
        window,
        resolve: resolveJob,
        promise,
        cancelled: false,
      };
      enqueue(job);
      return promise;
    })();

    requests.set(key, request);
    try {
      return await request;
    } finally {
      if (requests.get(key) === request && !knownJobs.has(key)) requests.delete(key);
    }
  };

  const cancel = async (trackId: string, role?: RouletteSourceRole): Promise<boolean> => {
    const matching = [...knownJobs.values()].filter((job) => (
      job.track.id === trackId && (!role || job.role === role)
    ));
    let cancelled = false;
    for (const job of matching) {
      job.cancelled = true;
      cancelled = true;
      if (active !== job) {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        finish(job, initialState(job.track.id, job.role, 'cancelled', job.window, 'Preview preparation was cancelled. Try again when you are ready.', 'retry'));
        requests.delete(job.key);
      }
    }
    if (active && active.track.id === trackId && (!role || active.role === role)) {
      const desktop = dependencies.getDesktopBridge();
      if (desktop) await desktop.cancelRouletteStems(trackId);
    }
    return cancelled;
  };

  const retry = async (trackId: string, role: RouletteSourceRole): Promise<RoulettePreviewPreparationState | null> => {
    const previous = knownJobs.get(previewQueueKey(trackId, role));
    if (!previous) return null;
    knownJobs.delete(previous.key);
    requests.delete(previous.key);
    return prepare(previous.track, role);
  };

  const resumeSourceRequired = async (): Promise<void> => {
    const resumable = [...knownJobs.values()].filter((job) => (
      states.get(job.key)?.status === 'source-required' && !requests.has(job.key)
    ));
    for (const job of resumable) {
      knownJobs.delete(job.key);
      requests.delete(job.key);
      void prepare(job.track, job.role);
    }
  };

  const reconnectAndResume = async (trackId: string, role: RouletteSourceRole): Promise<boolean> => {
    const key = previewQueueKey(trackId, role);
    const state = states.get(key);
    const desktop = dependencies.getDesktopBridge();
    if (!desktop || state?.status !== 'source-required') return false;
    const reconnect = await desktop.reconnectUsb(state.requiredVolumeName);
    if (!reconnect.reconnected) return false;
    const previous = knownJobs.get(key);
    if (!previous) return false;
    knownJobs.delete(key);
    requests.delete(key);
    const resumed = await prepare(previous.track, role);
    return resumed.status === 'ready';
  };

  const resolvePreparedAsset = async (asset: RoulettePreparedAuditionAsset): Promise<ResolvedRouletteAuditionMedia | null> => {
    if (asset.kind === 'hq') {
      const resolved = await dependencies.stemAssets.resolveReady(
        asset.trackId,
        stemTypeForRole(asset.role),
        { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION },
      );
      if (!resolved) return null;
      return {
        assetKind: 'hq',
        role: asset.role,
        trackId: asset.trackId,
        window: asset.window,
        mediaStartMs: asset.window.sourceTimeMs,
        source: resolved.source,
      };
    }
    const desktop = dependencies.getDesktopBridge();
    if (!desktop) return null;
    const resolved = await desktop.resolveStemAsset(asset.output.locator);
    if (!resolved.ok) return null;
    return {
      assetKind: 'preview',
      role: asset.role,
      trackId: asset.trackId,
      window: asset.window,
      mediaStartMs: 0,
      source: resolved.source,
    };
  };

  return {
    prepare,
    getState: (trackId, role) => states.get(previewQueueKey(trackId, role)) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel,
    retry,
    resumeSourceRequired,
    reconnectAndResume,
    resolvePreparedAsset,
  };
}

export const roulettePreviewPreparationService = createRoulettePreviewPreparationService();
