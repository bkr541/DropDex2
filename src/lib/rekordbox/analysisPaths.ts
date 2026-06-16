const ANLZ_EXTS = new Set(['.dat', '.ext', '.2ex']);
const PIONEER_ANCHOR_UPPER = 'PIONEER/USBANLZ';

function hasTraversal(path: string): boolean {
  return path.split('/').some(p => p === '..' || p === '.');
}

/**
 * Normalize a raw ANLZ path: convert backslashes, strip leading slashes.
 * Returns null on traversal or unsupported extension.
 */
export function normalizeAnlzPath(rawPath: string): string | null {
  const p = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
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
 * Returns null when the anchor is missing, traversal detected, or extension invalid.
 */
export function getCanonicalAnlzPath(file: File): string | null {
  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!relPath) return null;

  const slashed = relPath.replace(/\\/g, '/');
  const anchorIdx = slashed.toUpperCase().indexOf(PIONEER_ANCHOR_UPPER);
  if (anchorIdx === -1) return null;

  const canonical = slashed.slice(anchorIdx);
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
