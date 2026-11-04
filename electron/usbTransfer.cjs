'use strict';

const { constants: fsConstants, promises: fs } = require('node:fs');
const path = require('node:path');
const { isPathInsideRoot } = require('./usbPathSafety.cjs');

// Copies a Rekordbox USB onto another drive. It only ever reads the source and only ever adds files to the destination:
// it never deletes or overwrites anything, and it skips files that are already there.

const REKORDBOX_FOLDER = 'PIONEER';
const TRACK_FOLDERS = ['Contents', 'Music'];
/** Folders the operating system puts on a drive that are not the DJ's files. */
const SYSTEM_NAMES = new Set([
  '.spotlight-v100', '.fseventsd', '.trashes', '.trash', '.temporaryitems', '.documentrevisions-v100', '.ds_store',
  'system volume information', '$recycle.bin', 'found.000', 'lost+found', '.apdisk', '.volumeicon.icns', 'thumbs.db',
]);
const MAX_RECORDED_FILES = 2000;
const CATEGORIES = ['tracks', 'rekordbox', 'other'];

function isSystemName(name) {
  const lower = name.toLowerCase();
  return SYSTEM_NAMES.has(lower) || lower.startsWith('._');
}

/** Which kind of file a top-level folder holds. */
function categoryForTopLevel(name) {
  if (name === REKORDBOX_FOLDER) return 'rekordbox';
  if (TRACK_FOLDERS.includes(name)) return 'tracks';
  return 'other';
}

/** Throws if the two folders are the same drive folder or one sits inside the other. */
function assertSafeTransferPaths(sourceRoot, destinationRoot) {
  if (!sourceRoot || !destinationRoot) throw new Error('Choose both drives before transferring.');
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (source === destination) throw new Error('The two drives are the same folder. Choose a different destination.');
  if (isPathInsideRoot(source, destination) || isPathInsideRoot(destination, source)) {
    throw new Error('One of these folders is inside the other. Choose a separate drive for the destination.');
  }
}

/** Every regular file under `directory`, as paths relative to `root`. Skips system files and symbolic links. */
async function* walkFiles(root, directory = root) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (isSystemName(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walkFiles(root, full);
    } else if (entry.isFile()) {
      yield path.relative(root, full);
    }
  }
}

/** Counts files and bytes for each kind of data on the source drive. */
async function scanTransferSource(sourceRoot) {
  const summary = Object.fromEntries(CATEGORIES.map((id) => [id, { fileCount: 0, totalBytes: 0 }]));
  let topLevel;
  try {
    topLevel = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return summary;
  }
  for (const entry of topLevel) {
    if (isSystemName(entry.name) || entry.isSymbolicLink()) continue;
    const category = categoryForTopLevel(entry.name);
    if (entry.isFile()) {
      const stat = await fs.stat(path.join(sourceRoot, entry.name)).catch(() => null);
      if (stat) { summary[category].fileCount += 1; summary[category].totalBytes += stat.size; }
      continue;
    }
    if (!entry.isDirectory()) continue;
    for await (const relative of walkFiles(sourceRoot, path.join(sourceRoot, entry.name))) {
      const stat = await fs.stat(path.join(sourceRoot, relative)).catch(() => null);
      if (!stat) continue;
      summary[category].fileCount += 1;
      summary[category].totalBytes += stat.size;
    }
  }
  return summary;
}

/** The files a transfer will go through, in order, for the chosen kinds of data. */
async function* listTransferFiles(sourceRoot, categories) {
  const wanted = new Set(categories);
  const topLevel = await fs.readdir(sourceRoot, { withFileTypes: true });
  topLevel.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of topLevel) {
    if (isSystemName(entry.name) || entry.isSymbolicLink()) continue;
    if (!wanted.has(categoryForTopLevel(entry.name))) continue;
    if (entry.isFile()) yield entry.name;
    else if (entry.isDirectory()) yield* walkFiles(sourceRoot, path.join(sourceRoot, entry.name));
  }
}

/**
 * Copies the chosen kinds of data from `sourceRoot` to `destinationRoot`.
 * `onProgress({ copied, skipped, failed, bytes, currentPath })` is called after every file.
 * `isCancelled()` is checked between files. Resolves with a summary and the (capped) list of files.
 */
async function runTransfer({ sourceRoot, destinationRoot, categories, onProgress = () => {}, isCancelled = () => false }) {
  assertSafeTransferPaths(sourceRoot, destinationRoot);
  const chosen = (Array.isArray(categories) ? categories : []).filter((id) => CATEGORIES.includes(id));
  if (chosen.length === 0) throw new Error('Choose what to transfer.');

  const result = {
    status: 'completed', copied: 0, skipped: 0, failed: 0, bytes: 0, files: [], filesTruncated: false, error: null,
  };
  const record = (relative, size, status) => {
    if (result.files.length < MAX_RECORDED_FILES) result.files.push({ path: relative.split(path.sep).join('/'), size, status });
    else result.filesTruncated = true;
  };

  for await (const relative of listTransferFiles(sourceRoot, chosen)) {
    if (isCancelled()) { result.status = 'cancelled'; break; }
    const from = path.join(sourceRoot, relative);
    const to = path.join(destinationRoot, relative);
    if (!isPathInsideRoot(destinationRoot, to)) { result.failed += 1; record(relative, 0, 'failed'); continue; }
    let size = 0;
    try {
      size = (await fs.stat(from)).size;
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
      result.copied += 1;
      result.bytes += size;
      record(relative, size, 'copied');
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        result.skipped += 1;
        record(relative, size, 'skipped');
      } else {
        result.failed += 1;
        record(relative, size, 'failed');
        if (!result.error) result.error = error instanceof Error ? error.message : String(error);
        // Out of space will fail every file after this one, so stop here instead of listing thousands of failures.
        if (error && (error.code === 'ENOSPC' || error.code === 'EROFS')) { result.status = 'failed'; break; }
      }
    }
    onProgress({ copied: result.copied, skipped: result.skipped, failed: result.failed, bytes: result.bytes, currentPath: relative.split(path.sep).join('/') });
  }

  if (result.status === 'completed' && result.failed > 0) result.status = result.copied > 0 ? 'partial' : 'failed';
  return result;
}

module.exports = {
  CATEGORIES,
  MAX_RECORDED_FILES,
  assertSafeTransferPaths,
  categoryForTopLevel,
  isSystemName,
  runTransfer,
  scanTransferSource,
};
