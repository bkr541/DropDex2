'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { AudioTrackCopyService, copyAudioFile, fingerprint, inspectVolume, segmentsSafe } = require('./audioTrackCopy.cjs');

const segments = ['Contents', 'Artist', 'Track.mp3'];
const destinationSegments = ['DropDex Audio', 'SOURCE', ...segments];
async function fixture(t, content = Buffer.alloc(700000, 42)) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dropdex-audio-copy-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'SOURCE'), destination = path.join(base, 'DESTINATION');
  for (const root of [source, destination]) {
    await fs.mkdir(path.join(root, 'PIONEER', 'rekordbox'), { recursive: true });
    await fs.writeFile(path.join(root, 'PIONEER', 'rekordbox', 'exportLibrary.db'), Buffer.from(`database:${root}`));
    await fs.writeFile(path.join(root, 'PIONEER', 'rekordbox', 'export.pdb'), 'cue metadata');
  }
  const filename = path.join(source, ...segments), target = path.join(destination, ...destinationSegments);
  await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, content);
  const sourceStamp = fingerprint(await fs.stat(filename));
  const untouched = await Promise.all([source, destination].map((root) => fs.readFile(path.join(root, 'PIONEER', 'rekordbox', 'exportLibrary.db'))));
  const run = (options = {}) => copyAudioFile({ sourceRoot: source, destinationRoot: destination, segments, destinationSegments, sourceStamp, ...options });
  const verifyMetadata = async () => {
    for (const [index, root] of [source, destination].entries()) {
      assert.deepEqual(await fs.readFile(path.join(root, 'PIONEER', 'rekordbox', 'exportLibrary.db')), untouched[index]);
      assert.equal(await fs.readFile(path.join(root, 'PIONEER', 'rekordbox', 'export.pdb'), 'utf8'), 'cue metadata');
    }
    assert.deepEqual(await fs.readFile(filename), content);
  };
  const parts = async () => (await fs.readdir(path.join(destination, 'DropDex Audio')).catch(() => [])).filter((name) => name.endsWith('.part'));
  return { source, destination, filename, target, content, run, parts, verifyMetadata, sourceStamp };
}

test('copies and verifies bytes, never changing the source or either Rekordbox database', async (t) => {
  const f = await fixture(t); const progress = [];
  const result = await f.run({ onProgress: (value) => progress.push(value) });
  assert.equal(result.status, 'copied'); assert.equal(result.bytes, f.content.length);
  assert.equal(result.sha256, crypto.createHash('sha256').update(f.content).digest('hex'));
  assert.deepEqual(await fs.readFile(f.target), f.content); assert.equal(result.cleanupIncomplete, false);
  assert.deepEqual(await f.parts(), []); assert.equal(progress.at(-1).percent, 100); await f.verifyMetadata();
});
test('never overwrites an existing destination', async (t) => {
  const f = await fixture(t); await fs.mkdir(path.dirname(f.target), { recursive: true }); await fs.writeFile(f.target, 'original destination');
  assert.equal((await f.run()).status, 'skipped'); assert.equal(await fs.readFile(f.target, 'utf8'), 'original destination'); await f.verifyMetadata();
});
test('exclusive creation also skips a collision that appears after preflight', async (t) => {
  const f = await fixture(t); let created = false;
  const result = await f.run({ onProgress: (value) => { if (!created && value.percent === 45) { created = true; sync.writeFileSync(f.target, 'late existing file'); } } });
  assert.equal(result.status, 'skipped'); assert.equal(await fs.readFile(f.target, 'utf8'), 'late existing file'); assert.deepEqual(await f.parts(), []);
});
for (const duringPublish of [false, true]) test(`cancellation during ${duringPublish ? 'publishing' : 'staging'} removes only its own partial files`, async (t) => {
  const f = await fixture(t); let cancelled = false;
  const result = await f.run({ isCancelled: () => cancelled, onProgress: (value) => { if (value.phase === 'copying' && value.percent >= (duringPublish ? 60 : 1)) cancelled = true; } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.cleanupIncomplete, false);
  assert.equal(await fs.stat(f.target).then(() => true, () => false), false); assert.deepEqual(await f.parts(), []); await f.verifyMetadata();
});
test('detects staged corruption before publishing', async (t) => {
  const f = await fixture(t); let corrupted = false;
  const result = await f.run({ onProgress: (value) => {
    if (!corrupted && value.percent === 45) { corrupted = true; const name = sync.readdirSync(path.join(f.destination, 'DropDex Audio')).find((name) => name.endsWith('.part')); sync.writeFileSync(path.join(f.destination, 'DropDex Audio', name), 'corrupted'); }
  } });
  assert.equal(result.status, 'failed'); assert.equal(await fs.stat(f.target).then(() => true, () => false), false); assert.deepEqual(await f.parts(), []); await f.verifyMetadata();
});
test('rejects a source changed since review', async (t) => {
  const f = await fixture(t); await fs.utimes(f.filename, new Date(), new Date(Date.now() + 10000));
  const result = await f.run(); assert.equal(result.status, 'failed'); assert.match(result.error, /changed/);
  assert.equal(await fs.stat(f.target).then(() => true, () => false), false);
});
test('missing audio, traversal, database files, and destination path changes are refused', async (t) => {
  const f = await fixture(t);
  for (const bad of [['..', 'Track.mp3'], ['PIONEER', 'Track.mp3'], ['Contents', 'exportLibrary.db'], ['/tmp', 'Track.mp3'], ['Contents', 'not-there.mp3']]) {
    assert.equal((await f.run({ segments: bad })).status, 'failed');
  }
  assert.equal((await f.run({ destinationSegments: ['PIONEER', 'rekordbox', 'Track.mp3'] })).status, 'failed');
  assert.equal((await f.run({ destinationSegments: ['DropDex Audio', 'SOURCE', 'exportLibrary.db'] })).status, 'failed');
  await f.verifyMetadata();
});
test('rejects symbolic links in source and destination folders', async (t) => {
  const f = await fixture(t); const other = path.join(f.destination, 'other'); await fs.mkdir(other);
  await fs.mkdir(path.join(f.destination, 'DropDex Audio')); await fs.symlink(other, path.join(f.destination, 'DropDex Audio', 'SOURCE'));
  assert.equal((await f.run()).status, 'failed'); assert.deepEqual(await fs.readdir(other), []);
  await fs.unlink(f.filename); await fs.symlink(path.join(f.source, 'PIONEER', 'rekordbox', 'export.pdb'), f.filename);
  assert.equal((await f.run()).status, 'failed');
});
test('a removed source still permits cleanup on a connected destination', async (t) => {
  const f = await fixture(t); let disconnected = false;
  const result = await f.run({ assertMounted: async () => { if (disconnected) throw new Error('source disconnected'); }, assertDestination: async () => {},
    onProgress: (value) => { if (value.percent > 0) disconnected = true; } });
  assert.equal(result.status, 'failed'); assert.equal(result.cleanupIncomplete, false); assert.deepEqual(await f.parts(), []); await f.verifyMetadata();
});
test('a disconnected destination is reported without deleting any replacement file', async (t) => {
  const f = await fixture(t); let disconnected = false;
  const assertMounted = async () => { if (disconnected) throw new Error('destination disconnected'); };
  const result = await f.run({ assertMounted, onProgress: (value) => { if (value.percent > 0) disconnected = true; } });
  assert.equal(result.status, 'failed'); assert.equal(result.cleanupIncomplete, true); await f.verifyMetadata();
});
test('observer errors cannot turn a verified copy into a failed job', async (t) => {
  const f = await fixture(t); const result = await f.run({ onProgress: () => { throw new Error('renderer closed'); } }); assert.equal(result.status, 'copied');
});

async function serviceFixture(t) {
  const f = await fixture(t);
  const inspect = async (root) => {
    const real = await fs.realpath(root), stat = await fs.stat(real), name = path.basename(root);
    return { root: real, stamp: `${stat.dev}:${stat.ino}`, volume: name, details: { volumeName: name, volumeUuid: name, deviceId: null, totalBytes: 10000000, filesystem: 'exFAT' } };
  };
  const service = new AudioTrackCopyService({ inspect });
  const a = await service.bind(f.source, { deviceId: 'a', deviceKey: 'uuid:SOURCE', label: 'SOURCE' });
  const b = await service.bind(f.destination, { deviceId: 'b', deviceKey: 'uuid:DESTINATION', label: 'DESTINATION' });
  const prepare = () => service.prepare({ sourceToken: a.token, destinationToken: b.token, segments });
  return { ...f, service, a, b, prepare };
}
test('review uses drive capabilities and a source fingerprint; plans are single-use', async (t) => {
  const f = await serviceFixture(t), plan = await f.prepare();
  assert.equal(plan.destinationPath, destinationSegments.join('/')); assert.equal('root' in plan.source, false); assert.equal('root' in plan.destination, false);
  assert.equal((await f.service.start(plan.id)).result.status, 'copied'); await assert.rejects(f.service.start(plan.id), /expired/); await f.verifyMetadata();
});
test('rejects wrong USB identity, same drive, extra renderer fields and unknown capabilities', async (t) => {
  const f = await serviceFixture(t);
  await assert.rejects(f.service.bind(f.source, { deviceId: 'wrong', deviceKey: 'uuid:OTHER', label: 'SOURCE' }), /does not match/);
  await assert.rejects(f.service.prepare({ sourceToken: f.a.token, destinationToken: f.a.token, segments }), /different USB/);
  await assert.rejects(f.service.prepare({ sourceToken: 'unapproved', destinationToken: f.b.token, segments }), /Locate both/);
  await assert.rejects(f.service.prepare({ sourceToken: f.a.token, destinationToken: f.b.token, segments, destinationRoot: '/tmp' }), /Invalid/);
  assert.equal(segmentsSafe(['Contents', 'Track.mp3']), true); assert.equal(segmentsSafe(['Contents', 'PIONEER', 'Track.mp3']), true); assert.equal(segmentsSafe(['PIONEER', 'track.mp3']), false);
});
test('rebinding a drive invalidates previous copy reviews', async (t) => {
  const f = await serviceFixture(t), plan = await f.prepare();
  await f.service.bind(f.source, { deviceId: 'a', deviceKey: 'uuid:SOURCE', label: 'SOURCE' }); await assert.rejects(f.service.start(plan.id), /expired|again/);
});
test('concurrent copies are refused and cancellation waits for cleanup', async (t) => {
  const f = await serviceFixture(t), plan = await f.prepare();
  const running = f.service.start(plan.id);
  await assert.rejects(f.service.start(plan.id), /already running/);
  await f.service.cancelAndWait(); const completed = await running; assert.equal(completed.result.status, 'cancelled'); assert.equal(f.service.active, null); assert.deepEqual(await f.parts(), []);
});
test('expired reviews cannot write files', async (t) => {
  const f = await serviceFixture(t), plan = await f.prepare();
  f.service.plans.get(plan.id).expiresAt = 0; await assert.rejects(f.service.start(plan.id), /expired/); assert.equal(await fs.stat(f.target).then(() => true, () => false), false);
});
test('ordinary folders cannot be selected as mounted USB roots in production', async (t) => {
  const f = await fixture(t); await assert.rejects(inspectVolume(f.source), /root of the mounted USB/);
});

test('insufficient capacity fails before creating an audio file', async (t) => {
  const f = await fixture(t); t.mock.method(fs, 'statfs', async () => ({ bavail: 0, bsize: 4096 }));
  const result = await f.run(); assert.equal(result.status, 'failed'); assert.match(result.error, /room/);
  assert.equal(await fs.stat(f.target).then(() => true, () => false), false); await f.verifyMetadata();
});
test('read-only destination errors preserve source and database bytes', async (t) => {
  const f = await fixture(t), mkdir = fs.mkdir.bind(fs);
  t.mock.method(fs, 'mkdir', async (filename, ...args) => {
    if (filename.startsWith(f.destination)) throw Object.assign(new Error('read only'), { code: 'EROFS' });
    return mkdir(filename, ...args);
  });
  const result = await f.run(); assert.equal(result.status, 'failed'); assert.match(result.error, /read-only/); await f.verifyMetadata();
});
test('final verification failure removes its newly created output', async (t) => {
  const f = await fixture(t); let corrupted = false;
  const result = await f.run({ onProgress: (value) => { if (!corrupted && value.percent === 96) { corrupted = true; sync.writeFileSync(f.target, 'bad final'); } } });
  assert.equal(result.status, 'failed'); assert.equal(await fs.stat(f.target).then(() => true, () => false), false); await f.verifyMetadata();
});
test('cleanup never deletes a user replacement at the output path', async (t) => {
  const f = await fixture(t); let replaced = false;
  const result = await f.run({ isCancelled: () => replaced, onProgress: (value) => {
    if (!replaced && value.phase === 'copying' && value.percent >= 60) {
      sync.renameSync(f.target, f.target + '.renamed'); sync.writeFileSync(f.target, 'user replacement'); replaced = true;
    }
  } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.cleanupIncomplete, true); assert.equal(await fs.readFile(f.target, 'utf8'), 'user replacement'); await f.verifyMetadata();
});
test('a replaced mount point cannot receive writes from an old binding', async (t) => {
  const f = await serviceFixture(t), plan = await f.prepare();
  await fs.rename(f.destination, f.destination + '.old'); await fs.mkdir(f.destination); await fs.writeFile(path.join(f.destination, 'keep.txt'), 'replacement volume');
  const completed = await f.service.start(plan.id); assert.equal(completed.result.status, 'failed');
  assert.deepEqual(await fs.readdir(f.destination), ['keep.txt']);
});
test('does not report success if the published path was replaced during final verification', async (t) => {
  const f = await fixture(t); let replaced = false;
  const result = await f.run({ onProgress: (value) => {
    if (!replaced && value.percent === 96) { sync.renameSync(f.target, f.target + '.ours'); sync.writeFileSync(f.target, 'replacement'); replaced = true; }
  } });
  assert.equal(result.status, 'failed'); assert.equal(await fs.readFile(f.target, 'utf8'), 'replacement'); await f.verifyMetadata();
});
