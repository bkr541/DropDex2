'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEncodeArgs, encodePreview, parseDurationMs, resolveFfmpegPath } = require('./previewEncoder.cjs');

test('reads a duration out of ffmpeg output', () => {
  assert.equal(parseDurationMs('  Duration: 00:03:21.45, start: 0.0'), 201450);
  assert.equal(parseDurationMs('Duration: 01:00:00.00'), 3600000);
  assert.equal(parseDurationMs('nothing here'), null);
});

test('asks for 160 kbps stereo AAC, drops artwork and tags, and never reads from the keyboard', () => {
  const args = buildEncodeArgs('/in.mp3', '/out.m4a');
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 4), ['-c:a', 'aac', '-b:a', '160k']);
  for (const flag of ['-vn', '-nostdin', '-map_metadata', '-movflags']) assert.ok(args.includes(flag), flag);
  assert.equal(args.at(-1), '/out.m4a');
});

test('uses the unpacked copy of the bundled ffmpeg inside a packaged app', () => {
  assert.equal(resolveFfmpegPath(() => '/Applications/DropDex.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'),
    '/Applications/DropDex.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
  assert.throws(() => resolveFfmpegPath(() => null), /missing/);
});

test('really encodes a file with the bundled ffmpeg, and cleans up its temporary file', async (t) => {
  const ffmpeg = resolveFfmpegPath();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-preview-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'tone.wav');
  execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6:sample_rate=48000', '-ac', '2', source]);
  const tmp = path.join(dir, 'tmp');
  await fs.mkdir(tmp);
  const result = await encodePreview(source, { ffmpegPath: ffmpeg, tmpDir: tmp });
  assert.ok(result.sizeBytes > 1000);
  assert.equal(result.bytes.length, result.sizeBytes);
  assert.ok(Math.abs(result.durationMs - 6000) < 100, `duration ${result.durationMs}`);
  const kbps = (result.sizeBytes * 8) / (result.durationMs / 1000) / 1000;
  assert.ok(kbps > 140 && kbps < 190, `bitrate ${kbps}`);
  assert.deepEqual(await fs.readdir(tmp), []);
});

test('says so plainly when the file is not audio', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-preview-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'notes.txt');
  await fs.writeFile(source, 'not audio');
  await assert.rejects(encodePreview(source, { tmpDir: dir }), (error) => error instanceof Error && error.message.length > 0);
});
