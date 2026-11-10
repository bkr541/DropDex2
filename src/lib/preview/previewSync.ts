import { useSyncExternalStore } from 'react';
import { logger } from '../logger';
import { supabase } from '../supabase';
import { resolveUsbPath } from '../rekordbox/usbPathResolver';
import { fetchPreviewStates, savePreviewRow, uploadPreviewFile, type PreviewRowInput, type PreviewState } from '../queries/trackPreviews';
import { fetchLibraryTracksPage } from '../queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import type { DesktopEncodePreviewResult } from '../../types/dropdex-desktop';
import { previewStoragePath, trackIdentityKey } from './trackIdentity';

export interface PreviewJob {
  trackId: string;
  title: string;
  identityKey: string;
  /** Where the file is on the USB, or null with `unusableReason` when the track has no usable path. */
  segments: string[] | null;
  unusableReason?: string;
}

export interface PreviewSyncDeps {
  encode(input: { segments: string[]; previous: { sourceSize: number; sourceMtimeMs: number } | null }): Promise<DesktopEncodePreviewResult>;
  upload(storagePath: string, bytes: Uint8Array): Promise<void>;
  save(row: PreviewRowInput): Promise<void>;
  storagePath(identityKey: string): Promise<string>;
}

export interface PreviewFailure { trackId: string; title: string; message: string }

export interface PreviewProgress {
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  current: string | null;
}

export interface PreviewSyncSummary extends PreviewProgress { cancelled: boolean; failures: PreviewFailure[] }

const FRIENDLY_ERRORS: Record<string, string> = {
  not_found: 'The file was not found on the USB.',
  permission_denied: 'DropDex was not allowed to read this file.',
  security: 'This file path was rejected for safety.',
  type_mismatch: 'This path is not a file.',
};

function describeEncodeError(error: { kind: string; message: string }): string {
  return FRIENDLY_ERRORS[error.kind] ?? error.message ?? 'The preview could not be made.';
}

async function withRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

/**
 * Makes and uploads the preview for each job, a few at a time. A track that fails is recorded and skipped; it never stops the
 * others. Tracks whose original has not changed since their last preview are left alone.
 */
export async function runPreviewSync({
  jobs, existing, deps, isCancelled = () => false, onProgress = () => undefined, onFailure = () => undefined, concurrency = 3,
}: {
  jobs: PreviewJob[];
  existing: ReadonlyMap<string, PreviewState>;
  deps: PreviewSyncDeps;
  isCancelled?: () => boolean;
  onProgress?: (progress: PreviewProgress) => void;
  onFailure?: (failure: PreviewFailure) => void;
  concurrency?: number;
}): Promise<PreviewSyncSummary> {
  const progress: PreviewProgress = { processed: 0, synced: 0, skipped: 0, failed: 0, current: null };
  const failures: PreviewFailure[] = [];
  let next = 0;
  let cancelled = false;

  const fail = (job: PreviewJob, message: string) => {
    progress.failed += 1;
    const failure = { trackId: job.trackId, title: job.title, message };
    failures.push(failure);
    onFailure(failure);
  };

  const handle = async (job: PreviewJob) => {
    progress.current = job.title;
    if (!job.segments) {
      fail(job, job.unusableReason ?? 'This track has no file path.');
      return;
    }
    const before = existing.get(job.identityKey);
    if (before?.pendingRemoval) {
      fail(job, 'Finish removing this copy in See Tracks before syncing it again.');
      return;
    }
    const previous = before?.status === 'ready' && before.sourceSize != null && before.sourceMtimeMs != null
      ? { sourceSize: before.sourceSize, sourceMtimeMs: before.sourceMtimeMs }
      : null;
    const encoded = await deps.encode({ segments: job.segments, previous });
    if (encoded.ok === false) {
      fail(job, describeEncodeError(encoded.error));
      return;
    }
    if (!('bytes' in encoded)) {
      progress.skipped += 1;
      return;
    }
    const storagePath = await deps.storagePath(job.identityKey);
    try {
      await withRetry(() => deps.upload(storagePath, encoded.bytes));
      await withRetry(() => deps.save({
        identityKey: job.identityKey, trackId: job.trackId, storagePath, sizeBytes: encoded.sizeBytes, durationMs: encoded.durationMs,
        bitrateKbps: encoded.bitrateKbps, sampleRate: encoded.sampleRate, channels: encoded.channels,
        sourceSize: encoded.sourceSize, sourceMtimeMs: encoded.sourceMtimeMs,
      }));
      progress.synced += 1;
    } catch (error) {
      fail(job, `Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const worker = async () => {
    while (!cancelled) {
      if (isCancelled()) { cancelled = true; return; }
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      try {
        await handle(jobs[index]);
      } catch (error) {
        fail(jobs[index], error instanceof Error ? error.message : String(error));
      }
      progress.processed += 1;
      onProgress({ ...progress });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, worker));
  return { ...progress, current: null, cancelled, failures };
}

/** Turns tracks into jobs: works out each track's identity and where its file is on the USB. */
export function buildPreviewJobs(tracks: readonly RekordboxTrack[], expectedVolume?: string | null): PreviewJob[] {
  return tracks.map((track) => {
    const identityKey = trackIdentityKey(track);
    const base = { trackId: track.id, title: track.title || 'Untitled track', identityKey };
    const resolution = resolveUsbPath(track.file_path, { expectedVolume: expectedVolume ?? undefined });
    if (resolution.status === 'ok') return { ...base, segments: resolution.segments };
    const reason = resolution.status === 'volume_mismatch'
      ? 'This track is on a different USB than the one connected.'
      : resolution.status === 'empty_path' ? 'This track has no file path.' : 'DropDex could not work out where this file is on the USB.';
    return { ...base, segments: null, unusableReason: reason };
  });
}

/** Every track of an import, fetched a page at a time. */
async function fetchAllImportTracks(importId: string, signal: AbortSignal): Promise<RekordboxTrack[]> {
  const all: RekordboxTrack[] = [];
  for (let offset = 0; ; offset += 500) {
    signal.throwIfAborted();
    const page = await fetchLibraryTracksPage(importId, offset, 500, {}, signal);
    all.push(...page.items);
    if (!page.hasMore || page.items.length === 0) break;
  }
  return all;
}

// ── One sync at a time, shared by the whole app, so it keeps going while you move between pages ─────────────────────────

export interface PreviewSyncState extends PreviewProgress {
  phase: 'idle' | 'preparing' | 'running' | 'done' | 'error';
  total: number;
  stopping: boolean;
  cancelled: boolean;
  failures: PreviewFailure[];
  message: string | null;
}

const IDLE: PreviewSyncState = { phase: 'idle', total: 0, processed: 0, synced: 0, skipped: 0, failed: 0, current: null, stopping: false, cancelled: false, failures: [], message: null };

let state: PreviewSyncState = IDLE;
let activeController: AbortController | null = null;
const listeners = new Set<() => void>();

function publish(next: PreviewSyncState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const previewSyncStore = {
  getState: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  cancel() {
    if (!activeController || state.stopping) return;
    publish({ ...state, stopping: true });
    activeController.abort();
  },
  reset() {
    if (state.phase !== 'preparing' && state.phase !== 'running') publish(IDLE);
  },
  /** Starts a sync for selected tracks or for every track of an import ID. Does nothing if one is already running. */
  async start(source: RekordboxTrack[] | string, options: { expectedVolume?: string | null; deps?: PreviewSyncDeps; userId?: string; existing?: Map<string, PreviewState> } = {}): Promise<void> {
    if (activeController) return;
    const controller = new AbortController();
    const { signal } = controller;
    activeController = controller;
    publish({ ...IDLE, phase: 'preparing' });

    let result: PreviewSyncState;
    try {
      const userId = options.userId ?? (await supabase.auth.getSession()).data.session?.user.id;
      signal.throwIfAborted();
      if (!userId) throw new Error('You need to be signed in to sync.');
      const bridge = typeof window !== 'undefined' ? window.dropdexDesktop : undefined;
      const deps: PreviewSyncDeps | null = options.deps ?? (bridge ? {
        encode: (input) => bridge.encodePreview(input),
        upload: uploadPreviewFile,
        save: (row) => savePreviewRow(userId, row),
        storagePath: (key) => previewStoragePath(userId, key),
      } : null);
      if (!deps) throw new Error('Syncing needs the DropDex desktop app, because it reads the files from your USB.');

      const tracks = typeof source === 'string' ? await fetchAllImportTracks(source, signal) : source;
      signal.throwIfAborted();
      const existing = options.existing ?? await fetchPreviewStates(signal);
      signal.throwIfAborted();
      const jobs = buildPreviewJobs(tracks, options.expectedVolume);
      logger.info('preview.sync.started', { tracks: jobs.length });
      publish({ ...state, phase: 'running', total: jobs.length });

      const summary = await runPreviewSync({
        jobs, existing, deps,
        isCancelled: () => signal.aborted,
        onProgress: (progress) => publish({ ...state, ...progress, phase: 'running' }),
        onFailure: (failure) => logger.error('preview.sync.track_failed', { trackId: failure.trackId, title: failure.title, message: failure.message }),
      });
      logger.info('preview.sync.finished', { synced: summary.synced, skipped: summary.skipped, failed: summary.failed, cancelled: summary.cancelled });
      result = { ...state, ...summary, phase: 'done', stopping: false, message: null };
    } catch (error) {
      if (signal.aborted) {
        result = { ...state, phase: 'done', stopping: false, cancelled: true, current: null };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('preview.sync.failed', { message });
        result = { ...state, phase: 'error', message };
      }
    }
    activeController = null;
    publish(result);
  },
};

export function usePreviewSync(): PreviewSyncState {
  return useSyncExternalStore(previewSyncStore.subscribe, previewSyncStore.getState, previewSyncStore.getState);
}
