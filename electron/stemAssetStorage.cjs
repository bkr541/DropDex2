'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isPathInsideRoot } = require('./usbPathSafety.cjs');

const STEM_STORAGE_FOLDER = 'roulette-stems';
const STEM_AUDIO_EXTENSIONS = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);

function stemStorageRoot(userDataPath) {
  return path.join(userDataPath, STEM_STORAGE_FOLDER);
}

function validateStemStorageLocator(locator) {
  if (typeof locator !== 'string' || !locator.trim()) return false;
  if (locator.includes('\0') || path.isAbsolute(locator)) return false;
  if (locator.includes('\\')) return false;
  const segments = locator.split('/');
  if (segments.length < 2 || segments.length > 12) return false;
  if (!STEM_AUDIO_EXTENSIONS.has(path.extname(segments.at(-1)).toLowerCase())) return false;
  return segments.every((segment) => (
    segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
  ));
}

async function resolveStemAssetFile(userDataPath, locator) {
  if (!validateStemStorageLocator(locator)) {
    return { ok: false, error: { kind: 'invalid_locator', message: 'Invalid stem storage locator.' } };
  }

  const rootPath = stemStorageRoot(userDataPath);
  const candidatePath = path.resolve(rootPath, ...locator.split('/'));
  if (!isPathInsideRoot(rootPath, candidatePath)) {
    return { ok: false, error: { kind: 'security', message: 'Stem path escaped managed storage.' } };
  }

  try {
    const [realUserData, realRoot, realCandidate] = await Promise.all([
      fs.realpath(userDataPath),
      fs.realpath(rootPath),
      fs.realpath(candidatePath),
    ]);
    if (!isPathInsideRoot(realUserData, realRoot) || !isPathInsideRoot(realRoot, realCandidate)) {
      return { ok: false, error: { kind: 'security', message: 'Stem path escaped managed storage.' } };
    }
    const stat = await fs.stat(realCandidate);
    if (!stat.isFile()) {
      return { ok: false, error: { kind: 'type_mismatch', message: 'Stem storage locator is not a file.' } };
    }
    return {
      ok: true,
      filePath: realCandidate,
      rootPath: realRoot,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : null;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, error: { kind: 'not_found', message: 'Stem file was not found.' } };
    }
    return {
      ok: false,
      error: { kind: 'unexpected', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function deleteStemAssetFile(userDataPath, locator) {
  const resolved = await resolveStemAssetFile(userDataPath, locator);
  if (!resolved.ok) {
    if (resolved.error.kind === 'not_found') return { ok: true, deleted: false };
    return resolved;
  }
  try {
    await fs.unlink(resolved.filePath);
    return { ok: true, deleted: true };
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : null;
    if (code === 'ENOENT') return { ok: true, deleted: false };
    return {
      ok: false,
      error: { kind: 'unexpected', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

module.exports = {
  STEM_AUDIO_EXTENSIONS,
  STEM_STORAGE_FOLDER,
  deleteStemAssetFile,
  resolveStemAssetFile,
  stemStorageRoot,
  validateStemStorageLocator,
};
