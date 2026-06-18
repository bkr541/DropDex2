const ANLZ_EXTS = new Set(['.dat', '.ext', '.2ex']);
const PIONEER_ANCHOR_UPPER = 'PIONEER/USBANLZ';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * An ANLZ file that has been matched against the import manifest.
 * `canonicalPath` is the PIONEER-anchored path used as the Storage key and
 * the multipart filename sent to the backend.
 */
export interface MatchedAnalysisFile {
  file: File;
  canonicalPath: string;
  /** The raw webkitRelativePath from the browser FileList */
  originalBrowserPath: string;
  /** DAT | EXT | 2EX */
  assetType: string;
  /** Supabase track row ID from the manifest */
  trackId: string;
}

function hasTraversal(path: string): boolean {
  return path.split('/').some(p => p === '..' || p === '.');
}

/**
 * Normalize a raw ANLZ path for storage and comparison.
 *
 * Handles: backslashes, Windows drive letters (D:\), duplicate slashes,
 * URL-encoded characters (%2F etc.), leading slashes.
 *
 * Returns null on path traversal (..) or unsupported file extension.
 */
export function normalizeAnlzPath(rawPath: string): string | null {
  // URL-decode first so %2F etc. resolve before any further processing.
  let p: string;
  try {
    p = decodeURIComponent(rawPath);
  } catch {
    p = rawPath;
  }
  p = p
    .replace(/\\/g, '/')            // backslash → forward slash
    .replace(/^[A-Za-z]:\//, '')    // strip Windows drive letter (D:/ → '')
    .replace(/^\/+/, '')            // strip leading slashes
    .replace(/\/+/g, '/');          // collapse duplicate separators
  if (!p || hasTraversal(p)) return null;
  const dotIdx = p.lastIndexOf('.');
  if (dotIdx === -1) return null;
  if (!ANLZ_EXTS.has(p.slice(dotIdx).toLowerCase())) return null;
  return p;
}

/** Returns false for absolute paths or paths with .. segments. */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  return !hasTraversal(path.replace(/\\/g, '/'));
}

/**
 * Extract the PIONEER-anchored canonical path from a File's webkitRelativePath.
 * e.g. "MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT" → "PIONEER/USBANLZ/P001/ANLZ0000.DAT"
 *
 * Handles: backslashes, Windows drive letters, macOS /Volumes paths, duplicate
 * slashes, and URL-encoded characters in the relative path.
 *
 * Returns null when the anchor is missing, traversal detected, or extension invalid.
 */
export function getCanonicalAnlzPath(file: File): string | null {
  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!relPath) return null;

  let normalized: string;
  try {
    normalized = decodeURIComponent(relPath);
  } catch {
    normalized = relPath;
  }
  normalized = normalized
    .replace(/\\/g, '/')         // backslash → forward slash
    .replace(/^[A-Za-z]:\//, '') // strip Windows drive letter
    .replace(/\/+/g, '/');       // collapse duplicate separators

  const anchorIdx = normalized.toUpperCase().indexOf(PIONEER_ANCHOR_UPPER);
  if (anchorIdx === -1) return null;

  const canonical = normalized.slice(anchorIdx);
  if (hasTraversal(canonical)) return null;

  const dotIdx = canonical.lastIndexOf('.');
  if (dotIdx === -1) return null;
  if (!ANLZ_EXTS.has(canonical.slice(dotIdx).toLowerCase())) return null;

  return canonical;
}

/** True when the file's extension is .dat, .ext, or .2ex (case-insensitive). */
export function isAnlzFile(file: File): boolean {
  const dotIdx = file.name.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return ANLZ_EXTS.has(file.name.slice(dotIdx).toLowerCase());
}

/** Find exportLibrary.db within a FileList (case-insensitive). */
export function findDatabaseFile(files: File[]): File | null {
  for (const f of files) {
    if (f.name.toLowerCase() === 'exportlibrary.db') return f;
  }
  return null;
}

/**
 * Build a list of all expected paths from the manifest (dat/ext/two_ex).
 * Null paths are omitted.
 */
export function extractManifestPaths(
  manifest: Array<{ dat_path: string | null; ext_path: string | null; two_ex_path: string | null }>,
): string[] {
  const paths: string[] = [];
  for (const entry of manifest) {
    if (entry.dat_path) paths.push(entry.dat_path);
    if (entry.ext_path) paths.push(entry.ext_path);
    if (entry.two_ex_path) paths.push(entry.two_ex_path);
  }
  return paths;
}

/**
 * Match ANLZ files from a folder pick against a list of expected manifest paths.
 * Returns a Map from lowercase(canonical_path) → File.
 */
export function matchFilesToManifest(
  files: File[],
  manifestPaths: string[],
): Map<string, File> {
  const result = new Map<string, File>();
  const expected = new Set(manifestPaths.map(p => p.toLowerCase()));

  for (const f of files) {
    const canonical = getCanonicalAnlzPath(f);
    if (!canonical) continue;
    const lower = canonical.toLowerCase();
    if (expected.has(lower)) result.set(lower, f);
  }
  return result;
}

/**
 * Build a typed MatchedAnalysisFile array from a folder pick and the import manifest.
 *
 * Each file is included only if its canonical PIONEER-anchored path matches one
 * of the paths listed in the manifest (dat_path, ext_path, two_ex_path).  Two
 * files with the same basename in different directories are correctly
 * distinguished via their full canonical path.
 */
export function buildMatchedFiles(
  files: File[],
  manifest: Array<{
    track_id: string;
    dat_path: string | null;
    ext_path: string | null;
    two_ex_path: string | null;
  }>,
): MatchedAnalysisFile[] {
  // Build: lower(canonical_path) → { trackId, assetType }
  const expected = new Map<string, { trackId: string; assetType: string }>();
  for (const entry of manifest) {
    if (entry.dat_path)
      expected.set(entry.dat_path.toLowerCase(), { trackId: entry.track_id, assetType: 'DAT' });
    if (entry.ext_path)
      expected.set(entry.ext_path.toLowerCase(), { trackId: entry.track_id, assetType: 'EXT' });
    if (entry.two_ex_path)
      expected.set(entry.two_ex_path.toLowerCase(), { trackId: entry.track_id, assetType: '2EX' });
  }

  const result: MatchedAnalysisFile[] = [];
  for (const f of files) {
    const canonical = getCanonicalAnlzPath(f);
    if (!canonical) continue;
    const meta = expected.get(canonical.toLowerCase());
    if (!meta) continue;
    result.push({
      file: f,
      canonicalPath: canonical,
      originalBrowserPath:
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name,
      assetType: meta.assetType,
      trackId: meta.trackId,
    });
  }
  return result;
}

/**
 * Split MatchedAnalysisFile[] into upload batches.
 *
 * A new batch is started whenever the next file would cause the current batch
 * to exceed `maxFilesPerBatch` or `maxBytesPerBatch`.
 *
 * `maxBytesPerBatch` is compared against `File.size` (unread); no I/O
 * is performed here.
 */
export function buildBatches(
  files: MatchedAnalysisFile[],
  maxFilesPerBatch: number,
  maxBytesPerBatch: number,
): MatchedAnalysisFile[][] {
  const batches: MatchedAnalysisFile[][] = [];
  let current: MatchedAnalysisFile[] = [];
  let currentBytes = 0;

  for (const item of files) {
    const willExceedCount = current.length >= maxFilesPerBatch;
    const willExceedBytes = currentBytes + item.file.size > maxBytesPerBatch && current.length > 0;

    if (willExceedCount || willExceedBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += item.file.size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
