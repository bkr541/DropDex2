'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PREVIEW_ALGORITHM_VERSION,
  RESULT_PREFIX,
  StemSeparationBridge,
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

function previewInput(trackId, sourceFilePath, overrides = {}) {
  return {
    trackId,
    role: 'vocal',
    sourceFingerprint: `fingerprint-${trackId}`,
    algorithmVersion: PREVIEW_ALGORITHM_VERSION,
    windowStartMs: 8_000,
    windowEndMs: 40_000,
    sourceFilePath,
    ...overrides,
  };
}

function previewSpawn({ delayMs = 5, onStart = () => {}, onFinish = () => {} } = {}) {
  return (_command, args) => {
    onStart(args);
    const child = fakeChild();
    const output = args[args.indexOf('--output') + 1];
    const durationMs = Number(args[args.indexOf('--expected-duration-ms') + 1]);
    setTimeout(async () => {
      if (child.killed) return;
      const pair = path.join(output, 'pair');
      await mkdir(pair, { recursive: true });
      await writeFile(path.join(pair, 'vocals.wav'), 'preview vocals');
      await writeFile(path.join(pair, 'instrumental.wav'), 'preview instrumental');
      child.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
        ok: true,
        outputs: {
          vocals: { durationMs, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(durationMs) },
          instrumental: { durationMs, sampleRateHz: 44100, channelCount: 2, metrics: testMetrics(durationMs) },
        },
      })}\n`);
      onFinish(args);
      child.emit('exit', 0, null);
    }, delayMs);
    return child;
  };
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dropdex-preview-'));
  const sourceA = path.join(root, 'source-a.wav');
  const sourceB = path.join(root, 'source-b.wav');
  await writeFile(sourceA, 'source a');
  await writeFile(sourceB, 'source b');
  return { root, sourceA, sourceB };
}

test('preview preparation is globally serialized and only passes the selected 16-bar window to the worker', async () => {
  const { root, sourceA, sourceB } = await makeFixture();
  let active = 0;
  let maxActive = 0;
  const launches = [];
  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn: previewSpawn({
      delayMs: 15,
      onStart: (args) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        launches.push(args);
      },
      onFinish: () => { active -= 1; },
    }),
  });

  try {
    const [first, second] = await Promise.all([
      bridge.preparePreview(previewInput('track-a', sourceA)),
      bridge.preparePreview(previewInput('track-b', sourceB, { role: 'instrumental' })),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(maxActive, 1);
    assert.equal(launches.length, 2);
    for (const args of launches) {
      assert.equal(args[args.indexOf('--window-start-ms') + 1], '8000');
      assert.equal(args[args.indexOf('--window-duration-ms') + 1], '32000');
      assert.equal(args[args.indexOf('--expected-duration-ms') + 1], '32000');
    }
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('preview cache identity reuses the same source/window/version and invalidates when the window changes', async () => {
  const { root, sourceA } = await makeFixture();
  let spawnCount = 0;
  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn: previewSpawn({ onStart: () => { spawnCount += 1; } }),
  });

  try {
    const input = previewInput('track-a', sourceA);
    const first = await bridge.preparePreview(input);
    const cached = await bridge.preparePreview(input);
    const changedWindow = await bridge.preparePreview({ ...input, windowStartMs: 16_000, windowEndMs: 48_000 });
    assert.equal(first.ok, true);
    assert.equal(first.cached, false);
    assert.equal(cached.ok, true);
    assert.equal(cached.cached, true);
    assert.equal(changedWindow.ok, true);
    assert.equal(changedWindow.cached, false);
    assert.equal(spawnCount, 2);
    assert.notEqual(first.outputs.vocals.locator, changedWindow.outputs.vocals.locator);
    assert.match(first.outputs.vocals.locator, /^previews\//);
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelling a queued preview never launches or publishes that job', async () => {
  const { root, sourceA, sourceB } = await makeFixture();
  let spawnCount = 0;
  const bridge = new StemSeparationBridge({
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: {},
    platform: process.platform,
    userDataPath: () => path.join(root, 'userData'),
    spawn: previewSpawn({ delayMs: 30, onStart: () => { spawnCount += 1; } }),
  });

  try {
    const first = bridge.preparePreview(previewInput('track-a', sourceA));
    const second = bridge.preparePreview(previewInput('track-b', sourceB));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(bridge.cancel('track-b'), { ok: true, cancelled: true });
    const cancelled = await second;
    const completed = await first;
    assert.equal(completed.ok, true);
    assert.deepEqual(cancelled, {
      ok: false,
      error: { kind: 'cancelled', message: 'Preview preparation was cancelled.' },
    });
    assert.equal(spawnCount, 1);
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
