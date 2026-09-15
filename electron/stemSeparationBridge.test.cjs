'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  HEALTH_RESULT_PREFIX,
  RESULT_PREFIX,
  PREVIEW_ALGORITHM_VERSION,
  SEPARATOR_VERSION,
  StemSeparationBridge,
  atomicPublishDirectory,
} = require('./stemSeparationBridge.cjs');

function testMetrics(durationMs) {
  return {
    version: 'roulette-stem-metrics-v1',
    durationMs,
    rms: 0.05,
    signalRatio: 0.8,
    usableNonSilentDurationMs: durationMs,
    activityEvidence: 0.7,
    energyStability: 0.9,
    suitabilityScore: 0.8,
    bins: [{ startMs: 0, endMs: durationMs, rms: 0.05, signalRatio: 0.8, nonSilentRatio: 0.9 }],
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (signal = 'SIGTERM') => {
    if (child.killed) return false;
    child.killed = true;
    process.nextTick(() => child.emit('exit', null, signal));
    return true;
  };
  return child;
}

test('atomicPublishDirectory swaps a complete pair directory as one managed unit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-publish-'));
  try {
    const prepared = path.join(root, 'prepared');
    const finalDir = path.join(root, 'generated', 'track', 'identity');
    await mkdir(prepared, { recursive: true });
    await mkdir(finalDir, { recursive: true });
    await writeFile(path.join(prepared, 'vocals.wav'), 'new vocals');
    await writeFile(path.join(prepared, 'instrumental.wav'), 'new instrumental');
    await writeFile(path.join(finalDir, 'vocals.wav'), 'old vocals');

    await atomicPublishDirectory(prepared, finalDir);

    assert.equal(await readFile(path.join(finalDir, 'vocals.wav'), 'utf8'), 'new vocals');
    assert.equal(await readFile(path.join(finalDir, 'instrumental.wav'), 'utf8'), 'new instrumental');
    await assert.rejects(stat(prepared));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge deduplicates identical work and publishes both managed outputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-job-'));
  const source = path.join(root, 'source.wav');
  await writeFile(source, 'source audio');
  let spawnCount = 0;

  const spawn = (_command, args) => {
    spawnCount += 1;
    const child = fakeChild();
    const output = args[args.indexOf('--output') + 1];
    process.nextTick(async () => {
      const pair = path.join(output, 'pair');
      await mkdir(pair, { recursive: true });
      await writeFile(path.join(pair, 'vocals.wav'), 'vocals');
      await writeFile(path.join(pair, 'instrumental.wav'), 'instrumental');
      child.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
        ok: true,
        outputs: {
          vocals: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(1000) },
          instrumental: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(1000) },
        },
      })}\n`);
      child.emit('exit', 0, null);
    });
    return child;
  };

  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn,
  });

  try {
    const input = {
      trackId: 'track-1',
      sourceFingerprint: 'source-fingerprint',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: source,
    };
    const [first, second] = await Promise.all([bridge.prepare(input), bridge.prepare(input)]);

    assert.equal(spawnCount, 1);
    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.match(first.outputs.vocals.locator, /^generated\//);
    assert.match(first.outputs.instrumental.locator, /^generated\//);
    assert.equal(first.cached, false);
    assert.equal(first.outputs.vocals.metrics.version, 'roulette-stem-metrics-v1');

    const cached = await bridge.prepare(input);
    assert.equal(spawnCount, 1);
    assert.equal(cached.ok, true);
    assert.equal(cached.cached, true);
    assert.equal(cached.outputs.instrumental.metrics.version, 'roulette-stem-metrics-v1');
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge cancellation terminates work and never returns ready outputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-cancel-'));
  const source = path.join(root, 'source.wav');
  await writeFile(source, 'source audio');

  const spawn = () => fakeChild();
  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn,
  });

  try {
    const pending = bridge.prepare({
      trackId: 'track-1',
      sourceFingerprint: 'source-fingerprint',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: source,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(bridge.cancel('track-1'), { ok: true, cancelled: true });
    const result = await pending;
    assert.deepEqual(result, {
      ok: false,
      error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' },
    });
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});


test('StemSeparationBridge health reports available only after runtime, model, decoder worker, and storage checks succeed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-health-'));
  try {
    const checkpointDir = path.join(root, 'bridge', 'runtime', 'stem-models', 'hub', 'checkpoints');
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(path.join(checkpointDir, 'htdemucs.th'), 'model');
    const spawn = () => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stdout.write(`${HEALTH_RESULT_PREFIX}${JSON.stringify({ ok: true, reason: null })}\n`);
        child.emit('exit', 0, null);
      });
      return child;
    };
    const bridge = new StemSeparationBridge({
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      env: { DROPDEX_PYTHON: 'python3' },
      platform: process.platform,
      userDataPath: () => path.join(root, 'userData'),
      spawn,
    });

    await assert.doesNotReject(async () => {
      const health = await bridge.health();
      assert.equal(health.available, true);
      assert.equal(health.reason, null);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge health distinguishes an unprovisioned development runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-runtime-missing-'));
  try {
    const bridge = new StemSeparationBridge({
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      env: {},
      platform: process.platform,
      userDataPath: () => path.join(root, 'userData'),
    });
    const health = await bridge.health();
    assert.deepEqual(health, {
      available: false,
      reason: 'runtime_missing',
      message: 'The Roulette stem runtime has not been provisioned on this installation.',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge health distinguishes missing htdemucs model weights without running separation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-model-missing-'));
  let spawnCount = 0;
  try {
    const spawn = () => {
      spawnCount += 1;
      const child = fakeChild();
      process.nextTick(() => {
        child.stdout.write(`${HEALTH_RESULT_PREFIX}${JSON.stringify({ ok: false, reason: 'model_missing', message: 'missing model' })}\n`);
        child.emit('exit', 1, null);
      });
      return child;
    };
    const bridge = new StemSeparationBridge({
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      env: { DROPDEX_PYTHON: 'python3' },
      platform: process.platform,
      userDataPath: () => path.join(root, 'userData'),
      spawn,
    });
    const health = await bridge.health();
    assert.equal(health.available, false);
    assert.equal(health.reason, 'model_missing');
    assert.equal(spawnCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge health preserves structured dependency reasons from the runtime worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-dependency-health-'));
  try {
    const spawn = () => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stdout.write(`${HEALTH_RESULT_PREFIX}${JSON.stringify({ ok: false, reason: 'decoder_unavailable', message: 'ffmpeg missing' })}\n`);
        child.emit('exit', 1, null);
      });
      return child;
    };
    const bridge = new StemSeparationBridge({
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      env: { DROPDEX_PYTHON: 'python3' },
      platform: process.platform,
      userDataPath: () => path.join(root, 'userData'),
      spawn,
    });
    const health = await bridge.health();
    assert.equal(health.available, false);
    assert.equal(health.reason, 'decoder_unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge health reports unwritable or invalid local stem storage deterministically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-storage-bad-'));
  try {
    const checkpointDir = path.join(root, 'bridge', 'runtime', 'stem-models', 'hub', 'checkpoints');
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(path.join(checkpointDir, 'htdemucs.th'), 'model');
    const userDataFile = path.join(root, 'not-a-directory');
    await writeFile(userDataFile, 'file');
    const bridge = new StemSeparationBridge({
      isPackaged: false,
      resourcesPath: root,
      appPath: root,
      env: { DROPDEX_PYTHON: 'python3' },
      platform: process.platform,
      userDataPath: () => userDataFile,
      spawn: () => { throw new Error('health worker should not spawn'); },
    });
    const health = await bridge.health();
    assert.equal(health.available, false);
    assert.equal(health.reason, 'storage_unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StemSeparationBridge globally serializes HQ and preview workers behind one desktop-owned slot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-global-queue-'));
  const sourceA = path.join(root, 'source-a.wav');
  const sourceB = path.join(root, 'source-b.wav');
  const sourceC = path.join(root, 'source-c.wav');
  await Promise.all([
    writeFile(sourceA, 'source audio a'),
    writeFile(sourceB, 'source audio b'),
    writeFile(sourceC, 'source audio c'),
  ]);
  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  const launches = [];

  const spawn = (_command, args) => {
    activeWorkers += 1;
    maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
    launches.push([...args]);
    const child = fakeChild();
    const output = args[args.indexOf('--output') + 1];
    const expectedIndex = args.indexOf('--expected-duration-ms');
    const durationMs = expectedIndex >= 0 ? Number(args[expectedIndex + 1]) : 1000;
    setTimeout(async () => {
      if (child.killed) return;
      const pair = path.join(output, 'pair');
      await mkdir(pair, { recursive: true });
      await writeFile(path.join(pair, 'vocals.wav'), 'vocals');
      await writeFile(path.join(pair, 'instrumental.wav'), 'instrumental');
      child.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
        ok: true,
        outputs: {
          vocals: { durationMs, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(durationMs) },
          instrumental: { durationMs, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(durationMs) },
        },
      })}\n`);
      activeWorkers -= 1;
      child.emit('exit', 0, null);
    }, 15);
    return child;
  };

  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn,
  });

  try {
    const hqA = bridge.prepare({
      trackId: 'hq-a',
      sourceFingerprint: 'fingerprint-hq-a',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: sourceA,
    });
    const preview = bridge.preparePreview({
      trackId: 'preview-b',
      role: 'vocal',
      sourceFingerprint: 'fingerprint-preview-b',
      algorithmVersion: PREVIEW_ALGORITHM_VERSION,
      windowStartMs: 0,
      windowEndMs: 1000,
      sourceFilePath: sourceB,
    });
    const hqC = bridge.prepare({
      trackId: 'hq-c',
      sourceFingerprint: 'fingerprint-hq-c',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: sourceC,
    });

    const results = await Promise.all([hqA, preview, hqC]);
    assert.deepEqual(results.map((result) => result.ok), [true, true, true]);
    assert.equal(maxActiveWorkers, 1);
    assert.equal(launches.length, 3);
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
});

test('StemSeparationBridge cancels queued HQ work before it can launch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-stem-cancel-queued-hq-'));
  const sourceA = path.join(root, 'source-a.wav');
  const sourceB = path.join(root, 'source-b.wav');
  await Promise.all([writeFile(sourceA, 'source a'), writeFile(sourceB, 'source b')]);
  let spawnCount = 0;

  const spawn = (_command, args) => {
    spawnCount += 1;
    const child = fakeChild();
    const output = args[args.indexOf('--output') + 1];
    setTimeout(async () => {
      if (child.killed) return;
      const pair = path.join(output, 'pair');
      await mkdir(pair, { recursive: true });
      await writeFile(path.join(pair, 'vocals.wav'), 'vocals');
      await writeFile(path.join(pair, 'instrumental.wav'), 'instrumental');
      child.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
        ok: true,
        outputs: {
          vocals: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(1000) },
          instrumental: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(1000) },
        },
      })}\n`);
      child.emit('exit', 0, null);
    }, 30);
    return child;
  };

  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn,
  });

  try {
    const first = bridge.prepare({
      trackId: 'track-a',
      sourceFingerprint: 'fingerprint-a',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: sourceA,
    });
    const queued = bridge.prepare({
      trackId: 'track-b',
      sourceFingerprint: 'fingerprint-b',
      separatorVersion: SEPARATOR_VERSION,
      expectedDurationMs: 1000,
      sourceFilePath: sourceB,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(bridge.cancel('track-b'), { ok: true, cancelled: true });
    assert.deepEqual(await queued, {
      ok: false,
      error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' },
    });
    assert.equal((await first).ok, true);
    assert.equal(spawnCount, 1);
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
});
