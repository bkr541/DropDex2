'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { existsSync, promises: fs } = require('node:fs');
const { isPathInsideRoot } = require('./usbPathSafety.cjs');
const { stemStorageRoot } = require('./stemAssetStorage.cjs');

const RESULT_PREFIX = 'DROPDEX_STEM_RESULT:';
const SEPARATOR_VERSION = 'demucs-4.0.1-htdemucs-two-stem-v1';
const STEM_MODEL_NAME = 'htdemucs';
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CAPTURE_BYTES = 1_000_000;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function packagedBinaryPath(resourcesPath, platform = process.platform) {
  const filename = platform === 'win32' ? 'dropdex-rekordbox-bridge.exe' : 'dropdex-rekordbox-bridge';
  return path.join(resourcesPath, 'rekordbox-bridge', filename);
}

function defaultModelRoot({ isPackaged, resourcesPath, appPath, env }) {
  if (env.DROPDEX_STEM_MODEL_ROOT) return path.resolve(env.DROPDEX_STEM_MODEL_ROOT);
  if (isPackaged) return path.join(resourcesPath, 'rekordbox-bridge', 'stem-models');
  return path.join(appPath, 'bridge', 'runtime', 'stem-models');
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
    command: env.DROPDEX_PYTHON || (platform === 'win32' ? 'python' : 'python3'),
    args: ['-m', 'rekordbox_bridge.stem_separator', ...workerArgs],
    cwd: path.join(appPath, 'bridge'),
    packaged: false,
  };
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

async function statIdentity(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Stem separation source is not a file.');
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameIdentity(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
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
  return {
    durationMs: Math.round(workerMetadata.durationMs),
    sampleRateHz: Math.round(workerMetadata.sampleRateHz),
    channelCount: Math.round(workerMetadata.channelCount),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
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
  }

  _jobKey(trackId, sourceFingerprint, separatorVersion) {
    return hash(`${trackId}\0${sourceFingerprint}\0${separatorVersion}`);
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

  cancel(trackId) {
    let cancelled = false;
    for (const job of this.jobs.values()) {
      if (job.trackId !== trackId) continue;
      job.cancelled = true;
      cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
    }
    return { ok: true, cancelled };
  }

  close() {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
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

      await atomicPublishDirectory(preparedDir, finalDir);
      const [publishedVocals, publishedInstrumental] = await Promise.all([
        inspectPublishedStem(path.join(finalDir, 'vocals.wav'), vocalsMeta),
        inspectPublishedStem(path.join(finalDir, 'instrumental.wav'), instrumentalMeta),
      ]);

      return {
        ok: true,
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
  JOB_TIMEOUT_MS,
  RESULT_PREFIX,
  SEPARATOR_VERSION,
  STEM_MODEL_NAME,
  StemSeparationBridge,
  atomicPublishDirectory,
  defaultModelRoot,
  resolveLaunch,
};
