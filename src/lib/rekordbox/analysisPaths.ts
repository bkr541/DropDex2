/**
 * Rekordbox folder discovery is intentionally read-only. These helpers inspect
 * File metadata and paths only; they never obtain writable filesystem handles.
 */
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
  assetType: 'DAT' | 'EXT' | '2EX';
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

/** True only for DAT/EXT files used by the initial fast-path import. */
export function isBlockingAnlzFile(file: File): boolean {
  const dotIdx = file.name.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const extension = file.name.slice(dotIdx).toLowerCase();
  return extension === '.dat' || extension === '.ext';
}

/** Find exportLibrary.db within a FileList (case-insensitive). */
export function findDatabaseFile(files: File[]): File | null {
  for (const f of files) {
    if (f.name.toLowerCase() === 'exportlibrary.db') return f;
  }
  return null;
}

export interface AnalysisManifestWorkEntry {
  track_id: string;
  dat_path: string | null;
  ext_path: string | null;
  two_ex_path: string | null;
  manifest_status?: string;
  required_asset_types?: string[];
  optional_archival_asset_types?: string[];
}

const NO_USB_UPLOAD_STATUSES = new Set([
  'reused',
  'metadata_only',
  'reparse_from_retained',
  'unavailable',
]);

export function requiredAssetTypesForManifestEntry(
  entry: AnalysisManifestWorkEntry,
): Array<'DAT' | 'EXT'> {
  if (NO_USB_UPLOAD_STATUSES.has(entry.manifest_status ?? 'needs_analysis')) return [];
  if (entry.required_asset_types) {
    return ['DAT', 'EXT'].filter((type): type is 'DAT' | 'EXT' =>
      entry.required_asset_types?.includes(type) ?? false,
    );
  }
  if (entry.manifest_status === 'needs_ext') return ['EXT'];
  return ['DAT', 'EXT'];
}

export interface ManifestWorkSummary {
  requiredAnalysisFiles: number;
  optionalArchivalFiles: number;
  tracksRequiringAnalysis: number;
  tracksAlreadyReusable: number;
  unavailableTracks: number;
  affectedTrackIds: string[];
  uploadBatchCount: number;
}

/** Deterministic operation-count plan used by the UI and performance tests. */
export function summarizeManifestWork(
  manifest: AnalysisManifestWorkEntry[],
  maxFilesPerBatch = 50,
): ManifestWorkSummary {
  let requiredAnalysisFiles = 0;
  let optionalArchivalFiles = 0;
  let tracksAlreadyReusable = 0;
  let unavailableTracks = 0;
  const affectedTrackIds: string[] = [];

  for (const entry of manifest) {
    const status = entry.manifest_status ?? 'needs_analysis';
    if (status === 'reused' || status === 'metadata_only') tracksAlreadyReusable += 1;
    if (status === 'unavailable') unavailableTracks += 1;
    if (!NO_USB_UPLOAD_STATUSES.has(status)) {
      affectedTrackIds.push(entry.track_id);
    } else if (status === 'reparse_from_retained') {
      affectedTrackIds.push(entry.track_id);
    }
    const required = requiredAssetTypesForManifestEntry(entry);
    if (required.includes('DAT') && entry.dat_path) requiredAnalysisFiles += 1;
    if (required.includes('EXT') && entry.ext_path) requiredAnalysisFiles += 1;
    if (entry.two_ex_path) optionalArchivalFiles += 1;
  }

  return {
    requiredAnalysisFiles,
    optionalArchivalFiles,
    tracksRequiringAnalysis: affectedTrackIds.length,
    tracksAlreadyReusable,
    unavailableTracks,
    affectedTrackIds,
    uploadBatchCount: Math.ceil(requiredAnalysisFiles / Math.max(1, maxFilesPerBatch)),
  };
}

/** Build only the paths requested by the manifest. .2EX is opt-in archival work. */
export function extractManifestPaths(
  manifest: AnalysisManifestWorkEntry[],
  options?: { includeOptionalArchival?: boolean },
): string[] {
  const paths: string[] = [];
  for (const entry of manifest) {
    const required = requiredAssetTypesForManifestEntry(entry);
    if (required.includes('DAT') && entry.dat_path) paths.push(entry.dat_path);
    if (required.includes('EXT') && entry.ext_path) paths.push(entry.ext_path);
    if (
      options?.includeOptionalArchival &&
      entry.two_ex_path &&
      (entry.optional_archival_asset_types ?? ['2EX']).includes('2EX')
    ) {
      paths.push(entry.two_ex_path);
    }
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
 * of the paths explicitly requested by each manifest status. Optional .2EX
 * archival is excluded by default. Two
 * files with the same basename in different directories are correctly
 * distinguished via their full canonical path.
 */
export function buildMatchedFiles(
  files: File[],
  manifest: AnalysisManifestWorkEntry[],
  options?: { includeOptionalArchival?: boolean },
): MatchedAnalysisFile[] {
  // Build: lower(canonical_path) → { trackId, assetType }. Manifest status is
  // authoritative, so reused/metadata-only/retained tracks upload nothing.
  const expected = new Map<
    string,
    { trackId: string; assetType: 'DAT' | 'EXT' | '2EX' }
  >();
  for (const entry of manifest) {
    const required = requiredAssetTypesForManifestEntry(entry);
    if (required.includes('DAT') && entry.dat_path)
      expected.set(entry.dat_path.toLowerCase(), { trackId: entry.track_id, assetType: 'DAT' });
    if (required.includes('EXT') && entry.ext_path)
      expected.set(entry.ext_path.toLowerCase(), { trackId: entry.track_id, assetType: 'EXT' });
    if (
      options?.includeOptionalArchival &&
      entry.two_ex_path &&
      (entry.optional_archival_asset_types ?? ['2EX']).includes('2EX')
    ) {
      expected.set(entry.two_ex_path.toLowerCase(), { trackId: entry.track_id, assetType: '2EX' });
    }
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
