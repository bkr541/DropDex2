'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  RESULT_PREFIX,
  SEPARATOR_VERSION,
  StemSeparationBridge,
  atomicPublishDirectory,
} = require('./stemSeparationBridge.cjs');

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
          vocals: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2 },
          instrumental: { durationMs: 1000, sampleRateHz: 44100, channelCount: 2 },
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
