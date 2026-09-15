'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { constants, existsSync, promises: fs } = require('node:fs');
const { isPathInsideRoot } = require('./usbPathSafety.cjs');
const { stemStorageRoot } = require('./stemAssetStorage.cjs');

const RESULT_PREFIX = 'DROPDEX_STEM_RESULT:';
const HEALTH_RESULT_PREFIX = 'DROPDEX_STEM_HEALTH:';
const SEPARATOR_VERSION = 'demucs-4.0.1-htdemucs-two-stem-v1';
const PREVIEW_ALGORITHM_VERSION = 'demucs-4.0.1-htdemucs-16bar-preview-v1';
const STEM_MODEL_NAME = 'htdemucs';
const STEM_MANIFEST_CONTRACT_VERSION = 1;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 20 * 1000;
const MAX_CAPTURE_BYTES = 1_000_000;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function packagedBinaryPath(resourcesPath, platform = process.platform) {
  const filename = platform === 'win32' ? 'dropdex-rekordbox-bridge.exe' : 'dropdex-rekordbox-bridge';
  return path.join(resourcesPath, 'rekordbox-bridge', filename);
}

function defaultDevelopmentPython(appPath, platform = process.platform) {
  return path.join(
    appPath,
    'bridge',
    '.roulette-runtime-venv',
    platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
}

function defaultModelRoot({ isPackaged, resourcesPath, appPath, env }) {
  if (env.DROPDEX_STEM_MODEL_ROOT) return path.resolve(env.DROPDEX_STEM_MODEL_ROOT);
  if (isPackaged) return path.join(resourcesPath, 'rekordbox-bridge', 'stem-models');
  return path.join(appPath, 'bridge', 'runtime', 'stem-models');
}

function resolveDevelopmentCommand({ appPath, env, platform }) {
  if (env.DROPDEX_PYTHON) return env.DROPDEX_PYTHON;
  return defaultDevelopmentPython(appPath, platform);
}

function resolveLaunch(options, workerArgs) {
  const { isPackaged, resourcesPath, appPath, env, platform } = options;
  if (isPackaged) {
    const binary = packagedBinaryPath(resourcesPath, platform);
    if (!existsSync(binary)) return null;
    return {
      command: binary,
      args: ['--roulette-separate', ...workerArgs],
      cwd: path.dirname(binary),
      packaged: true,
    };
  }
  if (env.DROPDEX_STEM_SEPARATOR_BINARY) {
    return {
      command: env.DROPDEX_STEM_SEPARATOR_BINARY,
      args: ['--roulette-separate', ...workerArgs],
      cwd: appPath,
      packaged: false,
    };
  }
  return {
    command: resolveDevelopmentCommand(options),
    args: ['-m', 'rekordbox_bridge.stem_separator', ...workerArgs],
    cwd: path.join(appPath, 'bridge'),
    packaged: false,
  };
}

function resolveHealthLaunch(options, modelRoot) {
  const { isPackaged, resourcesPath, appPath, env, platform } = options;
  if (isPackaged) {
    const binary = packagedBinaryPath(resourcesPath, platform);
    if (!existsSync(binary)) return null;
    return {
      command: binary,
      args: ['--roulette-health', '--model-root', modelRoot],
      cwd: path.dirname(binary),
      packaged: true,
    };
  }
  if (env.DROPDEX_STEM_SEPARATOR_BINARY) {
    return {
      command: env.DROPDEX_STEM_SEPARATOR_BINARY,
      args: ['--roulette-health', '--model-root', modelRoot],
      cwd: appPath,
      packaged: false,
    };
  }
  return {
    command: resolveDevelopmentCommand(options),
    args: ['-m', 'rekordbox_bridge.stem_separator', '--health-check', '--model-root', modelRoot],
    cwd: path.join(appPath, 'bridge'),
    packaged: false,
  };
}

function unavailable(reason, message) {
  return { available: false, reason, message };
}

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Stem separation request is invalid.');
  if (typeof input.trackId !== 'string' || input.trackId.length < 1 || input.trackId.length > 256) {
    throw new Error('Stem separation trackId is invalid.');
  }
  if (typeof input.sourceFingerprint !== 'string' || input.sourceFingerprint.length < 1 || input.sourceFingerprint.length > 8192) {
    throw new Error('Stem separation source fingerprint is invalid.');
  }
  if (input.separatorVersion !== SEPARATOR_VERSION) {
    throw new Error('Stem separation version is unsupported.');
  }
  if (input.expectedDurationMs != null && (
    typeof input.expectedDurationMs !== 'number'
    || !Number.isFinite(input.expectedDurationMs)
    || input.expectedDurationMs < 0
    || input.expectedDurationMs > 24 * 60 * 60 * 1000
  )) {
    throw new Error('Stem separation expected duration is invalid.');
  }
  if (typeof input.sourceFilePath !== 'string' || !path.isAbsolute(input.sourceFilePath)) {
    throw new Error('Stem separation source path is invalid.');
  }
}

function validatePreviewRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Preview separation request is invalid.');
  if (typeof input.trackId !== 'string' || input.trackId.length < 1 || input.trackId.length > 256) {
    throw new Error('Preview separation trackId is invalid.');
  }
  if (input.role !== 'vocal' && input.role !== 'instrumental') throw new Error('Preview separation role is invalid.');
  if (typeof input.sourceFingerprint !== 'string' || input.sourceFingerprint.length < 1 || input.sourceFingerprint.length > 8192) {
    throw new Error('Preview separation source fingerprint is invalid.');
  }
  if (input.algorithmVersion !== PREVIEW_ALGORITHM_VERSION) throw new Error('Preview separation version is unsupported.');
  if (typeof input.sourceFilePath !== 'string' || !path.isAbsolute(input.sourceFilePath)) {
    throw new Error('Preview separation source path is invalid.');
  }
  for (const field of ['windowStartMs', 'windowEndMs']) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < 0) {
      throw new Error(`Preview separation ${field} is invalid.`);
    }
  }
  if (input.windowEndMs <= input.windowStartMs || input.windowEndMs - input.windowStartMs > 10 * 60 * 1000) {
    throw new Error('Preview separation window is invalid.');
  }
}

async function statIdentity(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Stem separation source is not a file.');
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameIdentity(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function validateStemMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Separator audio metrics are missing.');
  const numericFields = [
    'durationMs',
    'rms',
    'signalRatio',
    'usableNonSilentDurationMs',
    'activityEvidence',
    'energyStability',
    'suitabilityScore',
  ];
  if (typeof value.version !== 'string' || !value.version.trim()) throw new Error('Separator audio metrics version is invalid.');
  for (const field of numericFields) {
    if (!Number.isFinite(value[field]) || value[field] < 0) throw new Error(`Separator audio metrics ${field} is invalid.`);
  }
  if (!Array.isArray(value.bins)) throw new Error('Separator audio metric bins are invalid.');
  const bins = value.bins.map((bin) => {
    if (!bin || typeof bin !== 'object' || Array.isArray(bin)) throw new Error('Separator audio metric bin is invalid.');
    for (const field of ['startMs', 'endMs', 'rms', 'signalRatio', 'nonSilentRatio']) {
      if (!Number.isFinite(bin[field]) || bin[field] < 0) throw new Error(`Separator audio metric bin ${field} is invalid.`);
    }
    if (bin.endMs <= bin.startMs) throw new Error('Separator audio metric bin range is invalid.');
    return {
      startMs: Math.round(bin.startMs),
      endMs: Math.round(bin.endMs),
      rms: Math.min(1, bin.rms),
      signalRatio: Math.min(1, bin.signalRatio),
      nonSilentRatio: Math.min(1, bin.nonSilentRatio),
    };
  });
  return {
    version: value.version,
    durationMs: Math.round(value.durationMs),
    rms: Math.min(1, value.rms),
    signalRatio: Math.min(1, value.signalRatio),
    usableNonSilentDurationMs: Math.round(value.usableNonSilentDurationMs),
    activityEvidence: Math.min(1, value.activityEvidence),
    energyStability: Math.min(1, value.energyStability),
    suitabilityScore: Math.min(1, value.suitabilityScore),
    bins,
  };
}

async function inspectPublishedStem(filePath, workerMetadata) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Separator output is not a file.');
  if (!workerMetadata || typeof workerMetadata !== 'object') throw new Error('Separator output metadata is missing.');
  for (const field of ['durationMs', 'sampleRateHz', 'channelCount']) {
    if (!Number.isFinite(workerMetadata[field]) || workerMetadata[field] <= 0) {
      throw new Error(`Separator output ${field} is invalid.`);
    }
  }
  const durationMs = Math.round(workerMetadata.durationMs);
  const metrics = validateStemMetrics(workerMetadata.metrics);
  if (Math.abs(metrics.durationMs - durationMs) > 500) {
    throw new Error('Separator audio metrics do not match the output timeline.');
  }
  if (metrics.usableNonSilentDurationMs > metrics.durationMs + 500) {
    throw new Error('Separator usable-audio metrics exceed the output duration.');
  }
  return {
    durationMs,
    sampleRateHz: Math.round(workerMetadata.sampleRateHz),
    channelCount: Math.round(workerMetadata.channelCount),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    metrics,
  };
}

async function atomicPublishDirectory(preparedDir, finalDir) {
  const parent = path.dirname(finalDir);
  await fs.mkdir(parent, { recursive: true });
  const backupDir = `${finalDir}.previous-${crypto.randomUUID()}`;
  let movedPrevious = false;
  try {
    try {
      await fs.rename(finalDir, backupDir);
      movedPrevious = true;
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
    }
    await fs.rename(preparedDir, finalDir);
    if (movedPrevious) await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious) {
      try {
        await fs.rename(backupDir, finalDir);
      } catch { /* preserve original publish error */ }
    }
    throw error;
  }
}

class StemSeparationBridge {
  constructor(options) {
    this.options = options;
    this.jobs = new Map();
    this.previewJobs = new Map();
    this.previewQueue = [];
    this.previewActive = null;
    this.healthPromise = null;
  }

  _jobKey(trackId, sourceFingerprint, separatorVersion) {
    return hash(`${trackId}\0${sourceFingerprint}\0${separatorVersion}`);
  }

  async health({ refresh = false } = {}) {
    if (!refresh && this.healthPromise) return this.healthPromise;
    const promise = this._checkHealth().catch((error) => unavailable(
      'unexpected_failure',
      error instanceof Error ? error.message : String(error),
    ));
    this.healthPromise = promise;
    return promise;
  }

  async _checkHealth() {
    const modelRoot = defaultModelRoot(this.options);
    const launch = resolveHealthLaunch(this.options, modelRoot);
    if (!launch) {
      return unavailable('runtime_missing', 'The packaged Roulette stem runtime is unavailable.');
    }

    if (path.isAbsolute(launch.command)) {
      try {
        await fs.access(launch.command, this.options.platform === 'win32' ? constants.F_OK : constants.X_OK);
      } catch {
        return unavailable('runtime_missing', 'The Roulette stem runtime has not been provisioned on this installation.');
      }
    }

    const root = stemStorageRoot(this.options.userDataPath());
    let probeDir = null;
    try {
      await fs.mkdir(root, { recursive: true });
      probeDir = await fs.mkdtemp(path.join(root, '.health-'));
      const probeFile = path.join(probeDir, 'write-test');
      await fs.writeFile(probeFile, 'ok', { flag: 'wx' });
      await fs.unlink(probeFile);
    } catch (error) {
      return unavailable(
        'storage_unavailable',
        error instanceof Error ? `Local Roulette stem storage is not writable: ${error.message}` : 'Local Roulette stem storage is not writable.',
      );
    } finally {
      if (probeDir) await fs.rm(probeDir, { recursive: true, force: true }).catch(() => {});
    }

    return this._spawnHealthWorker(launch);
  }

  async prepare(input) {
    validateRequest(input);
    const key = this._jobKey(input.trackId, input.sourceFingerprint, input.separatorVersion);
    const existing = this.jobs.get(key);
    if (existing) return existing.promise;

    const job = { trackId: input.trackId, child: null, cancelled: false, promise: null };
    job.promise = this._runJob(input, job).finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
    return job.promise;
  }

  preparePreview(input) {
    validatePreviewRequest(input);
    const key = hash(`${input.trackId}\0${input.sourceFingerprint}\0${input.algorithmVersion}\0${input.windowStartMs}\0${input.windowEndMs}`);
    const existing = this.previewJobs.get(key);
    if (existing) return existing.promise;

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const job = {
      key,
      trackId: input.trackId,
      input,
      child: null,
      cancelled: false,
      started: false,
      settled: false,
      resolve: resolvePromise,
      promise,
    };
    this.previewJobs.set(key, job);
    this.previewQueue.push(job);
    this._pumpPreviewQueue();
    return promise;
  }

  _settlePreviewJob(job, result) {
    if (job.settled) return;
    job.settled = true;
    this.previewJobs.delete(job.key);
    job.resolve(result);
  }

  _pumpPreviewQueue() {
    if (this.previewActive) return;
    const job = this.previewQueue.shift();
    if (!job) return;
    if (job.settled) {
      this._pumpPreviewQueue();
      return;
    }
    if (job.cancelled) {
      this._settlePreviewJob(job, { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } });
      this._pumpPreviewQueue();
      return;
    }
    job.started = true;
    this.previewActive = job;
    void this._runPreviewJob(job.input, job)
      .then((result) => this._settlePreviewJob(job, result))
      .catch((error) => this._settlePreviewJob(job, {
        ok: false,
        error: { kind: 'processing_failed', message: error instanceof Error ? error.message : String(error) },
      }))
      .finally(() => {
        if (this.previewActive === job) this.previewActive = null;
        this._pumpPreviewQueue();
      });
  }

  cancel(trackId) {
    let cancelled = false;
    for (const job of this.jobs.values()) {
      if (job.trackId !== trackId) continue;
      job.cancelled = true;
      cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
    }
    for (const job of this.previewJobs.values()) {
      if (job.trackId !== trackId) continue;
      job.cancelled = true;
      cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
      if (!job.started) {
        this._settlePreviewJob(job, { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } });
      }
    }
    this.previewQueue = this.previewQueue.filter((job) => !job.settled);
    return { ok: true, cancelled };
  }

  close() {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
    }
    for (const job of this.previewJobs.values()) {
      job.cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
      if (!job.started) {
        this._settlePreviewJob(job, { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } });
      }
    }
    this.previewQueue = [];
  }

  async _loadCachedPreview(finalDir, finalLocatorDir, input) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(finalDir, 'manifest.json'), 'utf8'));
      if (
        manifest?.contractVersion !== STEM_MANIFEST_CONTRACT_VERSION
        || manifest?.algorithmVersion !== input.algorithmVersion
        || manifest?.sourceFingerprint !== input.sourceFingerprint
        || manifest?.windowStartMs !== input.windowStartMs
        || manifest?.windowEndMs !== input.windowEndMs
      ) return null;
      const [vocals, instrumental] = await Promise.all([
        inspectPublishedStem(path.join(finalDir, 'vocals.wav'), manifest.outputs?.vocals),
        inspectPublishedStem(path.join(finalDir, 'instrumental.wav'), manifest.outputs?.instrumental),
      ]);
      for (const [name, metadata] of [['vocals', vocals], ['instrumental', instrumental]]) {
        const expected = manifest.outputs?.[name];
        if (!expected || metadata.size !== expected.size || metadata.mtimeMs !== expected.mtimeMs) return null;
      }
      return {
        ok: true,
        cached: true,
        algorithmVersion: input.algorithmVersion,
        sourceFingerprint: input.sourceFingerprint,
        windowStartMs: input.windowStartMs,
        windowEndMs: input.windowEndMs,
        outputs: {
          vocals: { locator: `${finalLocatorDir}/vocals.wav`, ...vocals },
          instrumental: { locator: `${finalLocatorDir}/instrumental.wav`, ...instrumental },
        },
      };
    } catch {
      return null;
    }
  }

  async _runPreviewJob(input, job) {
    const userDataPath = this.options.userDataPath();
    const root = stemStorageRoot(userDataPath);
    const stagingRoot = path.join(root, '.staging');
    const jobId = crypto.randomUUID();
    const jobRoot = path.join(stagingRoot, `preview-${jobId}`);
    const preparedDir = path.join(jobRoot, 'pair');
    const trackDir = hash(input.trackId).slice(0, 20);
    const identityDir = hash(`${input.sourceFingerprint}\0${input.algorithmVersion}\0${input.windowStartMs}\0${input.windowEndMs}`).slice(0, 24);
    const finalLocatorDir = ['previews', trackDir, identityDir].join('/');
    const finalDir = path.join(root, 'previews', trackDir, identityDir);
    const modelRoot = defaultModelRoot(this.options);
    const previewDurationMs = Math.round(input.windowEndMs - input.windowStartMs);

    const cached = await this._loadCachedPreview(finalDir, finalLocatorDir, input);
    if (cached) return cached;

    const beforeIdentity = await statIdentity(input.sourceFilePath);
    await fs.mkdir(jobRoot, { recursive: true });
    try {
      const workerArgs = [
        '--source', input.sourceFilePath,
        '--output', jobRoot,
        '--model-root', modelRoot,
        '--model', STEM_MODEL_NAME,
        '--expected-duration-ms', String(previewDurationMs),
        '--window-start-ms', String(Math.round(input.windowStartMs)),
        '--window-duration-ms', String(previewDurationMs),
      ];
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } };
      const launch = resolveLaunch(this.options, workerArgs);
      if (!launch) {
        return { ok: false, error: { kind: 'runtime_unavailable', message: 'The packaged Roulette stem separator is unavailable. Reinstall DropDex.' } };
      }
      const worker = await this._spawnWorker(launch, job);
      if (!worker.ok) return worker;
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } };

      const afterIdentity = await statIdentity(input.sourceFilePath);
      if (!sameIdentity(beforeIdentity, afterIdentity)) {
        return { ok: false, error: { kind: 'source_changed', message: 'The source audio changed while the Roulette preview was being prepared.' } };
      }

      const vocalsPath = path.join(preparedDir, 'vocals.wav');
      const instrumentalPath = path.join(preparedDir, 'instrumental.wav');
      const [vocalsMeta, instrumentalMeta] = await Promise.all([
        inspectPublishedStem(vocalsPath, worker.result?.outputs?.vocals),
        inspectPublishedStem(instrumentalPath, worker.result?.outputs?.instrumental),
      ]);
      if (Math.abs(vocalsMeta.durationMs - previewDurationMs) > 500 || Math.abs(instrumentalMeta.durationMs - previewDurationMs) > 500) {
        return { ok: false, error: { kind: 'validation_failed', message: 'Generated preview duration does not match the selected 16-bar window.' } };
      }
      if (Math.abs(vocalsMeta.durationMs - instrumentalMeta.durationMs) > 2) {
        return { ok: false, error: { kind: 'validation_failed', message: 'Generated preview stem durations do not align.' } };
      }

      await fs.writeFile(path.join(preparedDir, 'manifest.json'), JSON.stringify({
        contractVersion: STEM_MANIFEST_CONTRACT_VERSION,
        algorithmVersion: input.algorithmVersion,
        sourceFingerprint: input.sourceFingerprint,
        windowStartMs: input.windowStartMs,
        windowEndMs: input.windowEndMs,
        outputs: { vocals: vocalsMeta, instrumental: instrumentalMeta },
      }), 'utf8');
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } };
      await atomicPublishDirectory(preparedDir, finalDir);
      const [publishedVocals, publishedInstrumental] = await Promise.all([
        inspectPublishedStem(path.join(finalDir, 'vocals.wav'), vocalsMeta),
        inspectPublishedStem(path.join(finalDir, 'instrumental.wav'), instrumentalMeta),
      ]);
      await fs.writeFile(path.join(finalDir, 'manifest.json'), JSON.stringify({
        contractVersion: STEM_MANIFEST_CONTRACT_VERSION,
        algorithmVersion: input.algorithmVersion,
        sourceFingerprint: input.sourceFingerprint,
        windowStartMs: input.windowStartMs,
        windowEndMs: input.windowEndMs,
        outputs: { vocals: publishedVocals, instrumental: publishedInstrumental },
      }), 'utf8');
      return {
        ok: true,
        cached: false,
        algorithmVersion: input.algorithmVersion,
        sourceFingerprint: input.sourceFingerprint,
        windowStartMs: input.windowStartMs,
        windowEndMs: input.windowEndMs,
        outputs: {
          vocals: { locator: `${finalLocatorDir}/vocals.wav`, ...publishedVocals },
          instrumental: { locator: `${finalLocatorDir}/instrumental.wav`, ...publishedInstrumental },
        },
      };
    } catch (error) {
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' } };
      const code = error && typeof error === 'object' ? error.code : null;
      if (code === 'ENOENT') {
        return { ok: false, error: { kind: 'processing_failed', message: 'The source audio or local preview runtime is unavailable.' } };
      }
      return { ok: false, error: { kind: 'processing_failed', message: error instanceof Error ? error.message : String(error) } };
    } finally {
      await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async _loadCachedHq(finalDir, finalLocatorDir, input) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(finalDir, 'manifest.json'), 'utf8'));
      if (
        manifest?.contractVersion !== STEM_MANIFEST_CONTRACT_VERSION
        || manifest?.separatorVersion !== input.separatorVersion
        || manifest?.sourceFingerprint !== input.sourceFingerprint
      ) return null;
      const [vocals, instrumental] = await Promise.all([
        inspectPublishedStem(path.join(finalDir, 'vocals.wav'), manifest.outputs?.vocals),
        inspectPublishedStem(path.join(finalDir, 'instrumental.wav'), manifest.outputs?.instrumental),
      ]);
      for (const [name, metadata] of [['vocals', vocals], ['instrumental', instrumental]]) {
        const expected = manifest.outputs?.[name];
        if (!expected || metadata.size !== expected.size || metadata.mtimeMs !== expected.mtimeMs) return null;
      }
      return {
        ok: true,
        cached: true,
        separatorVersion: input.separatorVersion,
        outputs: {
          vocals: { locator: `${finalLocatorDir}/vocals.wav`, ...vocals },
          instrumental: { locator: `${finalLocatorDir}/instrumental.wav`, ...instrumental },
        },
      };
    } catch {
      return null;
    }
  }

  async _runJob(input, job) {
    const userDataPath = this.options.userDataPath();
    const root = stemStorageRoot(userDataPath);
    const stagingRoot = path.join(root, '.staging');
    const jobId = crypto.randomUUID();
    const jobRoot = path.join(stagingRoot, jobId);
    const preparedDir = path.join(jobRoot, 'pair');
    const trackDir = hash(input.trackId).slice(0, 20);
    const identityDir = hash(`${input.sourceFingerprint}\0${input.separatorVersion}`).slice(0, 24);
    const finalLocatorDir = ['generated', trackDir, identityDir].join('/');
    const finalDir = path.join(root, 'generated', trackDir, identityDir);
    const modelRoot = defaultModelRoot(this.options);
    const cached = await this._loadCachedHq(finalDir, finalLocatorDir, input);
    if (cached) return cached;
    const beforeIdentity = await statIdentity(input.sourceFilePath);

    await fs.mkdir(jobRoot, { recursive: true });
    try {
      const workerArgs = [
        '--source', input.sourceFilePath,
        '--output', jobRoot,
        '--model-root', modelRoot,
        '--model', STEM_MODEL_NAME,
      ];
      if (input.expectedDurationMs != null) {
        workerArgs.push('--expected-duration-ms', String(input.expectedDurationMs));
      }
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' } };
      const launch = resolveLaunch(this.options, workerArgs);
      if (!launch) {
        return { ok: false, error: { kind: 'runtime_unavailable', message: 'The packaged Roulette stem separator is unavailable. Reinstall DropDex.' } };
      }

      const worker = await this._spawnWorker(launch, job);
      if (!worker.ok) return worker;
      if (job.cancelled) return { ok: false, error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' } };

      const afterIdentity = await statIdentity(input.sourceFilePath);
      if (!sameIdentity(beforeIdentity, afterIdentity)) {
        return { ok: false, error: { kind: 'source_changed', message: 'The source audio changed while stems were being prepared. Retry the track.' } };
      }

      const vocalsPath = path.join(preparedDir, 'vocals.wav');
      const instrumentalPath = path.join(preparedDir, 'instrumental.wav');
      if (!isPathInsideRoot(jobRoot, preparedDir) || !isPathInsideRoot(preparedDir, vocalsPath) || !isPathInsideRoot(preparedDir, instrumentalPath)) {
        return { ok: false, error: { kind: 'validation_failed', message: 'Separator output escaped managed staging storage.' } };
      }

      const [vocalsMeta, instrumentalMeta] = await Promise.all([
        inspectPublishedStem(vocalsPath, worker.result?.outputs?.vocals),
        inspectPublishedStem(instrumentalPath, worker.result?.outputs?.instrumental),
      ]);
      if (Math.abs(vocalsMeta.durationMs - instrumentalMeta.durationMs) > 2) {
        return { ok: false, error: { kind: 'validation_failed', message: 'Generated stem durations do not align.' } };
      }

      await fs.writeFile(path.join(preparedDir, 'manifest.json'), JSON.stringify({
        contractVersion: STEM_MANIFEST_CONTRACT_VERSION,
        separatorVersion: input.separatorVersion,
        sourceFingerprint: input.sourceFingerprint,
        outputs: { vocals: vocalsMeta, instrumental: instrumentalMeta },
      }), 'utf8');
      await atomicPublishDirectory(preparedDir, finalDir);
      const [publishedVocals, publishedInstrumental] = await Promise.all([
        inspectPublishedStem(path.join(finalDir, 'vocals.wav'), vocalsMeta),
        inspectPublishedStem(path.join(finalDir, 'instrumental.wav'), instrumentalMeta),
      ]);
      await fs.writeFile(path.join(finalDir, 'manifest.json'), JSON.stringify({
        contractVersion: STEM_MANIFEST_CONTRACT_VERSION,
        separatorVersion: input.separatorVersion,
        sourceFingerprint: input.sourceFingerprint,
        outputs: { vocals: publishedVocals, instrumental: publishedInstrumental },
      }), 'utf8');

      return {
        ok: true,
        cached: false,
        separatorVersion: SEPARATOR_VERSION,
        outputs: {
          vocals: { locator: `${finalLocatorDir}/vocals.wav`, ...publishedVocals },
          instrumental: { locator: `${finalLocatorDir}/instrumental.wav`, ...publishedInstrumental },
        },
      };
    } catch (error) {
      if (job.cancelled) {
        return { ok: false, error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' } };
      }
      const code = error && typeof error === 'object' ? error.code : null;
      if (code === 'ENOENT') {
        return { ok: false, error: { kind: 'runtime_unavailable', message: 'The local stem separator or source audio is unavailable.' } };
      }
      return {
        ok: false,
        error: { kind: 'processing_failed', message: error instanceof Error ? error.message : String(error) },
      };
    } finally {
      await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  _spawnHealthWorker(launch) {
    return new Promise((resolve) => {
      const spawnProcess = this.options.spawn ?? spawn;
      let child;
      try {
        child = spawnProcess(launch.command, launch.args, {
          cwd: launch.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            ...this.options.env,
            PYTHONUNBUFFERED: '1',
            TORCH_HOME: defaultModelRoot(this.options),
          },
        });
      } catch (error) {
        resolve(unavailable('runtime_missing', error instanceof Error ? error.message : String(error)));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const appendCapped = (current, chunk) => {
        const next = current + chunk;
        return Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES ? next : next.slice(-MAX_CAPTURE_BYTES);
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.on('error', (error) => finish(unavailable('runtime_missing', `Roulette stem runtime failed to start: ${error.message}`)));
      child.on('exit', () => {
        const line = stdout.split(/\r?\n/).filter((value) => value.startsWith(HEALTH_RESULT_PREFIX)).at(-1);
        if (line) {
          try {
            const payload = JSON.parse(line.slice(HEALTH_RESULT_PREFIX.length));
            if (payload?.ok === true) {
              finish({ available: true, reason: null, message: null, separatorVersion: SEPARATOR_VERSION });
              return;
            }
            const allowedReasons = new Set(['model_missing', 'dependency_unavailable', 'decoder_unavailable', 'unexpected_failure']);
            const reason = allowedReasons.has(payload?.reason) ? payload.reason : 'unexpected_failure';
            finish(unavailable(reason, typeof payload?.message === 'string' ? payload.message : 'Roulette runtime health check failed.'));
            return;
          } catch { /* fall through to deterministic failure below */ }
        }
        const summary = stderr.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).at(-1);
        finish(unavailable(
          'unexpected_failure',
          summary ? `Roulette runtime health check failed: ${summary.slice(0, 300)}` : 'Roulette runtime health check returned no result.',
        ));
      });
      timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
        finish(unavailable('unexpected_failure', 'Roulette runtime health check timed out.'));
      }, HEALTH_TIMEOUT_MS);
    });
  }

  _spawnWorker(launch, job) {
    return new Promise((resolve) => {
      const spawnProcess = this.options.spawn ?? spawn;
      const child = spawnProcess(launch.command, launch.args, {
        cwd: launch.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          ...this.options.env,
          PYTHONUNBUFFERED: '1',
          TORCH_HOME: defaultModelRoot(this.options),
        },
      });
      job.child = child;
      if (job.cancelled && !child.killed) child.kill('SIGTERM');
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        job.child = null;
        resolve(value);
      };
      const appendCapped = (current, chunk) => {
        const next = current + chunk;
        return Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES ? next : next.slice(-MAX_CAPTURE_BYTES);
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.on('error', (error) => finish({ ok: false, error: { kind: 'runtime_unavailable', message: `Local stem separator failed to start: ${error.message}` } }));
      child.on('exit', (code, signal) => {
        if (job.cancelled || signal === 'SIGTERM') {
          finish({ ok: false, error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' } });
          return;
        }
        const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX));
        const line = lines.at(-1);
        if (code === 0 && line) {
          try {
            const result = JSON.parse(line.slice(RESULT_PREFIX.length));
            if (result?.ok === true) {
              finish({ ok: true, result });
              return;
            }
            finish({ ok: false, error: { kind: 'processing_failed', message: result?.error || 'Stem separation failed.' } });
            return;
          } catch { /* report sanitized failure below */ }
        }
        const summary = stderr.split(/\r?\n/).map((lineValue) => lineValue.trim()).filter(Boolean).at(-1);
        finish({
          ok: false,
          error: {
            kind: 'processing_failed',
            message: summary ? `Local stem separation failed: ${summary.slice(0, 300)}` : `Local stem separator exited unexpectedly (${code ?? 'unknown'}).`,
          },
        });
      });
      timer = setTimeout(() => {
        job.cancelled = true;
        if (!child.killed) child.kill('SIGTERM');
        finish({ ok: false, error: { kind: 'processing_failed', message: 'Stem preparation exceeded the local processing time limit.' } });
      }, JOB_TIMEOUT_MS);
    });
  }
}

module.exports = {
  HEALTH_RESULT_PREFIX,
  HEALTH_TIMEOUT_MS,
  JOB_TIMEOUT_MS,
  RESULT_PREFIX,
  SEPARATOR_VERSION,
  PREVIEW_ALGORITHM_VERSION,
  STEM_MODEL_NAME,
  StemSeparationBridge,
  atomicPublishDirectory,
  defaultDevelopmentPython,
  defaultModelRoot,
  resolveHealthLaunch,
  resolveLaunch,
};
