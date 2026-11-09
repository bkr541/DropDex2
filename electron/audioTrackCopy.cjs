'use strict';

const { promises: fs, constants } = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { isPathInsideRoot, validateUsbPathSegments } = require('./usbPathSafety.cjs');
const { readUsbDetails } = require('./usbDetails.cjs');

const AUDIO = new Set(['.mp3', '.wav', '.wave', '.aif', '.aiff', '.aifc', '.flac', '.m4a', '.aac', '.ogg', '.opus']);
const COPY_FOLDER = 'DropDex Audio';
const PLAN_TTL = 120000;
const CHUNK = 256 * 1024;

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid audio copy request.');
}
function text(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function segmentsSafe(segments) {
  return Array.isArray(segments) && segments.length <= 128 && validateUsbPathSegments(segments)
    && segments[0].toLowerCase() !== 'pioneer'
    && segments.every((part) => part.length <= 255 && !/[<>:"|?*]/.test(part) && !/[. ]$/.test(part))
    && AUDIO.has(path.extname(segments[segments.length - 1]).toLowerCase());
}
function stamp(stat) { return `${stat.dev}:${stat.ino}`; }
function fingerprint(stat) { return `${stamp(stat)}:${stat.size}:${stat.mtimeMs}`; }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
async function present(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Reject symlinks at every level, including existing destination directories. */
async function safeDirectory(root, segments, create = false, assertMounted = async () => {}) {
  let current = root;
  for (const part of segments) {
    await assertMounted();
    current = path.join(current, part);
    if (!isPathInsideRoot(root, current)) throw new Error('The file path leaves the selected USB.');
    if (create) await fs.mkdir(current).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('USB paths containing symbolic links or non-folder entries cannot be used.');
    if (!isPathInsideRoot(root, await fs.realpath(current))) throw new Error('The file path leaves the selected USB.');
  }
  return current;
}
async function sourceFile(root, segments) {
  if (!segmentsSafe(segments)) throw new Error('Choose an audio track with a safe USB-relative file path. Rekordbox data files cannot be copied here.');
  const parent = await safeDirectory(root, segments.slice(0, -1));
  const filename = path.join(parent, segments.at(-1));
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error('The source must be a non-empty, regular audio file.');
  if (!isPathInsideRoot(root, await fs.realpath(filename))) throw new Error('The audio file is outside the selected USB.');
  return { filename, stat };
}
async function inspectVolume(root) {
  const real = await fs.realpath(root);
  const stat = await fs.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a mounted USB root.');
  const parent = await fs.stat(path.dirname(real));
  if (path.parse(real).root !== real && stat.dev === parent.dev) throw new Error('Select the root of the mounted USB, rather than a folder inside it.');
  const details = await readUsbDetails(real);
  if (process.platform === 'darwin' && details.removable === false && !/usb|thunderbolt|firewire/i.test(details.protocol || '')) throw new Error('Choose an external USB volume.');
  return { root: real, stamp: stamp(stat), volume: String(stat.dev), details };
}
function matchesDevice(expected, details) {
  if (expected.deviceKey.startsWith('uuid:')) return Boolean(details.volumeUuid && expected.deviceKey.slice(5).toLowerCase() === details.volumeUuid.toLowerCase());
  const name = details.volumeName.trim().toLowerCase();
  if (expected.label.trim().toLowerCase() !== name) return false;
  return expected.deviceKey === `name:${name}|unknown` || (details.totalBytes != null && expected.deviceKey === `name:${name}|${details.totalBytes}`);
}
function distinct(source, destination) {
  const whole = (details) => details.deviceId?.replace(/s\d+$/, '');
  if (source.volume === destination.volume || source.root === destination.root
    || isPathInsideRoot(source.root, destination.root) || isPathInsideRoot(destination.root, source.root)
    || (source.details.volumeUuid && source.details.volumeUuid === destination.details.volumeUuid)
    || (whole(source.details) && whole(source.details) === whole(destination.details))) {
    throw new Error('Choose two different USB drives.');
  }
}
async function rootCurrent(binding) {
  const stat = await fs.lstat(binding.root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stamp(stat) !== binding.stamp || await fs.realpath(binding.root) !== binding.root) {
    throw new Error('A selected USB was disconnected or replaced. Locate both USBs again.');
  }
}
async function freeSpace(root, size) {
  const space = await fs.statfs(root);
  if (Number(space.bavail) * Number(space.bsize) < size * 2) throw new Error('The destination needs room for the audio file and its verification copy.');
}
async function removeOwned(filename, identity, assertMounted) {
  if (!filename || !identity) return true;
  try {
    await assertMounted();
    const current = await present(filename);
    if (!current) return true;
    if (!sameFile(current, identity) || current.isSymbolicLink()) return false;
    await fs.unlink(filename);
    return true;
  } catch { return false; }
}

/** Copies only bytes to new files; no source writes, overwrite, or Rekordbox database access. */
async function copyAudioFile({ sourceRoot, destinationRoot, segments, sourceStamp, destinationSegments, assertMounted = async () => {}, assertDestination = assertMounted, isCancelled = () => false, onProgress = () => {} }) {
  let input, staging, output, stagingPath, finalPath, stagingIdentity, finalIdentity;
  let success = false;
  const result = { status: 'failed', bytes: 0, sha256: null, destinationPath: destinationSegments.join('/'), error: null, cleanupIncomplete: false };
  const check = async () => {
    if (isCancelled()) throw Object.assign(new Error('Audio copy stopped.'), { code: 'ABORT_ERR' });
    await assertMounted();
  };
  const report = (phase, bytes, size, percent) => { try { onProgress({ phase, bytes, totalBytes: size, percent }); } catch { /* UI observers cannot invalidate a copy. */ } };
  const digest = async (handle, size) => {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(CHUNK);
    let offset = 0;
    while (offset < size) {
      await check();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) throw new Error('A USB file could not be read completely.');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    return hash.digest('hex');
  };
  const stream = async (from, to, size, phase, base, weight) => {
    const buffer = Buffer.alloc(CHUNK), hash = crypto.createHash('sha256');
    let offset = 0;
    while (offset < size) {
      await check();
      const { bytesRead } = await from.read(buffer, 0, Math.min(CHUNK, size - offset), offset);
      if (!bytesRead) throw new Error('The source audio file changed or could not be read completely.');
      let written = 0;
      while (written < bytesRead) {
        await check();
        const { bytesWritten } = await to.write(buffer, written, bytesRead - written, offset + written);
        if (!bytesWritten) throw new Error('The destination USB stopped accepting data.');
        written += bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      report(phase, offset, size, Math.floor(base + weight * offset / size));
    }
    await to.sync();
    return hash.digest('hex');
  };
  try {
    sourceRoot = await fs.realpath(sourceRoot);
    destinationRoot = await fs.realpath(destinationRoot);
    await check();
    if (sourceRoot === destinationRoot || isPathInsideRoot(sourceRoot, destinationRoot) || isPathInsideRoot(destinationRoot, sourceRoot)) throw new Error('Choose two separate USB roots.');
    const source = await sourceFile(sourceRoot, segments);
    if (fingerprint(source.stat) !== sourceStamp) throw new Error('The source file changed. Review the copy again.');
    if (!validateUsbPathSegments(destinationSegments) || destinationSegments.length < 3 || destinationSegments[0] !== COPY_FOLDER || destinationSegments.at(-1) !== segments.at(-1)) throw new Error('Invalid destination audio path.');
    await safeDirectory(destinationRoot, destinationSegments.slice(0, -1), true, assertMounted);
    finalPath = path.join(destinationRoot, ...destinationSegments);
    if (await present(finalPath)) { result.status = 'skipped'; return result; }
    await freeSpace(destinationRoot, source.stat.size);
    input = await fs.open(source.filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (fingerprint(await input.stat()) !== sourceStamp) throw new Error('The source audio file changed.');
    stagingPath = path.join(destinationRoot, COPY_FOLDER, `.dropdex-${crypto.randomUUID()}.part`);
    await check();
    staging = await fs.open(stagingPath, 'wx+'); stagingIdentity = await staging.stat();
    const expected = await stream(input, staging, source.stat.size, 'copying', 0, 40);
    report('verifying', source.stat.size, source.stat.size, 45);
    if (await digest(staging, source.stat.size) !== expected || await digest(input, source.stat.size) !== expected
      || fingerprint(await input.stat()) !== sourceStamp) throw new Error('The staged audio did not match the source file.');
    await check();
    await safeDirectory(destinationRoot, destinationSegments.slice(0, -1), false, assertMounted);
    // Exclusive creation works on FAT/exFAT too; rename is never used to replace a destination.
    try { output = await fs.open(finalPath, 'wx+'); } catch (error) {
      if (error.code === 'EEXIST') { result.status = 'skipped'; return result; }
      throw error;
    }
    finalIdentity = await output.stat();
    if (!isPathInsideRoot(destinationRoot, await fs.realpath(finalPath))) throw new Error('The destination path changed.');
    await stream(staging, output, source.stat.size, 'copying', 60, 35);
    report('verifying', source.stat.size, source.stat.size, 96);
    if ((await output.stat()).size !== source.stat.size || await digest(output, source.stat.size) !== expected
      || fingerprint(await input.stat()) !== sourceStamp) throw new Error('The copied audio did not match the source file.');
    const published = await fs.lstat(finalPath);
    if (published.isSymbolicLink() || !sameFile(published, finalIdentity) || fingerprint(await fs.lstat(source.filename)) !== sourceStamp) {
      throw new Error('The source or destination file changed during verification.');
    }
    await check();
    success = true;
    Object.assign(result, { status: 'copied', bytes: source.stat.size, sha256: expected });
    report('verifying', source.stat.size, source.stat.size, 100);
  } catch (error) {
    result.status = error.code === 'ABORT_ERR' ? 'cancelled' : 'failed';
    result.error = error.code === 'ENOENT' ? 'A USB or the source audio file is no longer available.'
      : error.code === 'ENOSPC' ? 'The destination USB ran out of space.'
      : error.code === 'EROFS' || error.code === 'EACCES' ? 'The destination USB is read-only or access was denied.' : error.message;
  } finally {
    await Promise.all([input, staging, output].filter(Boolean).map((handle) => handle.close().catch(() => {})));
    const stagingRemoved = await removeOwned(stagingPath, stagingIdentity, assertDestination);
    const outputRemoved = success || await removeOwned(finalPath, finalIdentity, assertDestination);
    result.cleanupIncomplete = !stagingRemoved || !outputRemoved;
  }
  return result;
}

class AudioTrackCopyService {
  constructor({ inspect = inspectVolume, mounted = rootCurrent } = {}) {
    this.inspect = inspect; this.mounted = mounted; this.bindings = new Map(); this.plans = new Map(); this.active = null;
  }
  async bind(rootPath, expected) {
    exact(expected, ['deviceId', 'deviceKey', 'label']);
    if (![expected.deviceId, expected.deviceKey, expected.label].every(text)) throw new Error('Choose a saved USB first.');
    if (this.active) throw new Error('Stop the current audio copy before locating another USB.');
    const volume = await this.inspect(rootPath);
    if (!matchesDevice(expected, volume.details)) throw new Error('That mounted USB does not match the saved USB. Choose the matching drive.');
    for (const [token, binding] of this.bindings) if (binding.deviceId === expected.deviceId) this.bindings.delete(token);
    this.plans.clear();
    const binding = { ...volume, deviceId: expected.deviceId, token: crypto.randomUUID() };
    this.bindings.set(binding.token, binding);
    while (this.bindings.size > 16) this.bindings.delete(this.bindings.keys().next().value);
    return this.publicBinding(binding);
  }
  publicBinding(binding) { return { token: binding.token, deviceId: binding.deviceId, details: binding.details }; }
  async prepare(request) {
    exact(request, ['sourceToken', 'destinationToken', 'segments']);
    if (this.active) throw new Error('An audio copy is already running.');
    const source = this.bindings.get(request.sourceToken), destination = this.bindings.get(request.destinationToken);
    if (!source || !destination) throw new Error('Locate both mounted USBs again.');
    distinct(source, destination);
    await Promise.all([this.mounted(source), this.mounted(destination)]);
    const file = await sourceFile(source.root, request.segments);
    if (destination.details.filesystem === 'FAT32' && file.stat.size > 0xffffffff) throw new Error('This audio file exceeds the destination FAT32 file-size limit.');
    const sourceFolder = source.details.volumeName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'USB';
    const destinationSegments = [COPY_FOLDER, sourceFolder, ...request.segments];
    // Inspect existing directories without creating anything during review.
    let current = destination.root;
    for (const part of destinationSegments.slice(0, -1)) {
      current = path.join(current, part); const entry = await present(current);
      if (!entry) break;
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('The destination audio folder contains an unsafe path.');
    }
    const exists = Boolean(await present(path.join(destination.root, ...destinationSegments)));
    if (!exists) await freeSpace(destination.root, file.stat.size);
    const plan = { id: crypto.randomUUID(), source, destination, segments: [...request.segments], destinationSegments,
      sourceStamp: fingerprint(file.stat), sizeBytes: file.stat.size, expiresAt: Date.now() + PLAN_TTL };
    for (const [id, old] of this.plans) if (old.expiresAt < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 8) throw new Error('Close the previous copy review and try again.');
    this.plans.set(plan.id, plan);
    return { id: plan.id, source: this.publicBinding(source), destination: this.publicBinding(destination), sizeBytes: plan.sizeBytes,
      requiredBytes: plan.sizeBytes * 2, sourcePath: request.segments.join('/'), destinationPath: destinationSegments.join('/'),
      exists, expiresAt: plan.expiresAt };
  }
  async start(id, onProgress = () => {}) {
    if (this.active) throw new Error('An audio copy is already running.');
    const plan = this.plans.get(id); this.plans.delete(id);
    if (!plan || plan.expiresAt < Date.now()) throw new Error('This copy review expired. Review the track again.');
    if (this.bindings.get(plan.source.token) !== plan.source || this.bindings.get(plan.destination.token) !== plan.destination) throw new Error('Locate the selected USBs again.');
    const control = { id, cancelled: false, promise: null }; this.active = control;
    const startedAt = new Date().toISOString();
    control.promise = copyAudioFile({ sourceRoot: plan.source.root, destinationRoot: plan.destination.root, segments: plan.segments,
      sourceStamp: plan.sourceStamp, destinationSegments: plan.destinationSegments,
      assertMounted: async () => { await Promise.all([this.mounted(plan.source), this.mounted(plan.destination)]); },
      assertDestination: () => this.mounted(plan.destination),
      isCancelled: () => control.cancelled, onProgress: (value) => onProgress({ ...value, planId: id }) });
    try { return { result: await control.promise, startedAt, finishedAt: new Date().toISOString() }; }
    finally { if (this.active === control) this.active = null; }
  }
  cancel(id) {
    if (this.active?.id === id) { this.active.cancelled = true; return true; }
    return this.plans.delete(id);
  }
  async cancelAndWait() {
    if (this.active) { const active = this.active; active.cancelled = true; await active.promise; }
  }
}

module.exports = { AudioTrackCopyService, copyAudioFile, fingerprint, inspectVolume, matchesDevice, segmentsSafe };
