export type UsbFileResolutionError =
  | { kind: 'not_found'; path: string; message: string }
  | { kind: 'permission_denied'; message: string }
  | { kind: 'type_mismatch'; segment: string; message: string }
  | { kind: 'abort'; message: string }
  | { kind: 'security'; message: string }
  | { kind: 'unexpected'; message: string }
  /** Two or more entries in a directory match the same case-insensitive segment. */
  | { kind: 'ambiguous_case_match'; segment: string; candidates: string[]; path: string; message: string };

export type UsbFileResult =
  | { ok: true; file: File }
  | { ok: false; error: UsbFileResolutionError };

export interface ResolveUsbFileOptions {
  /** Cooperative cancellation checked between every async traversal step. */
  isCancelled?: () => boolean;
}

function cancelledError(): UsbFileResolutionError {
  return { kind: 'abort', message: 'USB file access was superseded by another playback request.' };
}

function cancelledResult(): UsbFileResult {
  return { ok: false, error: cancelledError() };
}

function mapDomException(err: unknown, path: string, lastSegment: string): UsbFileResolutionError {
  if (!(err instanceof DOMException)) {
    return { kind: 'unexpected', message: String(err) };
  }
  switch (err.name) {
    case 'NotFoundError':
      return { kind: 'not_found', path, message: `Not found: ${path}` };
    case 'NotAllowedError':
      return { kind: 'permission_denied', message: 'USB access permission was denied or revoked.' };
    case 'SecurityError':
      return { kind: 'security', message: 'A browser security policy blocked USB file access.' };
    case 'TypeMismatchError':
      return {
        kind: 'type_mismatch',
        segment: lastSegment,
        message: `Expected a file at "${lastSegment}" but found a directory.`,
      };
    case 'AbortError':
      return { kind: 'abort', message: 'USB file access was cancelled.' };
    default:
      return { kind: 'unexpected', message: `${err.name}: ${err.message}` };
  }
}

/**
 * Case-insensitive directory entry lookup.
 *
 * If `dir.getDirectoryHandle(name)` throws `NotFoundError`, enumerate
 * the directory entries and look for a case-insensitive match.
 * - Exactly one match → return it.
 * - Zero matches → original NotFoundError propagated as 'not_found'.
 * - Two or more matches → 'ambiguous_case_match' (caller cannot proceed safely).
 *
 * All other DOMExceptions (NotAllowedError, SecurityError, …) short-circuit
 * and are returned as their original error kinds.
 */
async function getDirectoryHandleCaseInsensitive(
  dir: FileSystemDirectoryHandle,
  name: string,
  fullPath: string,
  isCancelled?: () => boolean,
): Promise<{ handle: FileSystemDirectoryHandle } | { error: UsbFileResolutionError }> {
  if (isCancelled?.()) return { error: cancelledError() };
  try {
    const handle = await dir.getDirectoryHandle(name);
    if (isCancelled?.()) return { error: cancelledError() };
    return { handle };
  } catch (exact) {
    if (!(exact instanceof DOMException) || exact.name !== 'NotFoundError') {
      return { error: mapDomException(exact, fullPath, name) };
    }

    // Exact match failed — enumerate for case-insensitive fallback.
    const candidates: string[] = [];
    try {
      const iterable = dir as unknown as AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
      for await (const [entryName, entry] of iterable) {
        if (isCancelled?.()) return { error: cancelledError() };
        if (entry.kind === 'directory' && entryName.toLowerCase() === name.toLowerCase()) {
          candidates.push(entryName);
        }
      }
    } catch (iterErr) {
      return { error: mapDomException(iterErr, fullPath, name) };
    }

    if (candidates.length === 0) {
      return { error: { kind: 'not_found', path: fullPath, message: `Not found: ${fullPath}` } };
    }
    if (candidates.length > 1) {
      return {
        error: {
          kind: 'ambiguous_case_match',
          segment: name,
          candidates,
          path: fullPath,
          message: `Ambiguous: "${name}" matched ${candidates.join(', ')} in the same directory.`,
        },
      };
    }

    try {
      const handle = await dir.getDirectoryHandle(candidates[0]);
      if (isCancelled?.()) return { error: cancelledError() };
      return { handle };
    } catch (err) {
      return { error: mapDomException(err, fullPath, candidates[0]) };
    }
  }
}

/**
 * Case-insensitive file entry lookup — mirrors `getDirectoryHandleCaseInsensitive`
 * but for file handles.
 */
async function getFileHandleCaseInsensitive(
  dir: FileSystemDirectoryHandle,
  name: string,
  fullPath: string,
  isCancelled?: () => boolean,
): Promise<{ handle: FileSystemFileHandle } | { error: UsbFileResolutionError }> {
  if (isCancelled?.()) return { error: cancelledError() };
  try {
    const handle = await dir.getFileHandle(name);
    if (isCancelled?.()) return { error: cancelledError() };
    return { handle };
  } catch (exact) {
    if (!(exact instanceof DOMException) || exact.name !== 'NotFoundError') {
      return { error: mapDomException(exact, fullPath, name) };
    }

    const candidates: string[] = [];
    try {
      const iterable = dir as unknown as AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
      for await (const [entryName, entry] of iterable) {
        if (isCancelled?.()) return { error: cancelledError() };
        if (entry.kind === 'file' && entryName.toLowerCase() === name.toLowerCase()) {
          candidates.push(entryName);
        }
      }
    } catch (iterErr) {
      return { error: mapDomException(iterErr, fullPath, name) };
    }

    if (candidates.length === 0) {
      return { error: { kind: 'not_found', path: fullPath, message: `Not found: ${fullPath}` } };
    }
    if (candidates.length > 1) {
      return {
        error: {
          kind: 'ambiguous_case_match',
          segment: name,
          candidates,
          path: fullPath,
          message: `Ambiguous: "${name}" matched ${candidates.join(', ')} in the same directory.`,
        },
      };
    }

    try {
      const handle = await dir.getFileHandle(candidates[0]);
      if (isCancelled?.()) return { error: cancelledError() };
      return { handle };
    } catch (err) {
      return { error: mapDomException(err, fullPath, candidates[0]) };
    }
  }
}

/**
 * Traverse a FileSystemDirectoryHandle tree and return the File at the given
 * path segments rooted at `root`.
 *
 * Exact-name lookup is tried first. On `NotFoundError`, a case-insensitive
 * scan of the directory is performed. If exactly one case-insensitive match
 * exists it is used. If multiple entries match, an `ambiguous_case_match` error
 * is returned to avoid silently reading the wrong file.
 *
 * Privacy: returns an in-memory File object only. Callers must not persist,
 * upload, cache, or copy the file's contents.
 */
export async function resolveUsbFile(
  root: FileSystemDirectoryHandle,
  segments: string[],
  options: ResolveUsbFileOptions = {},
): Promise<UsbFileResult> {
  const { isCancelled } = options;
  if (isCancelled?.()) return cancelledResult();
  if (segments.length === 0) {
    return {
      ok: false,
      error: { kind: 'not_found', path: '', message: 'No path segments provided.' },
    };
  }

  const dirSegments = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  const fullPath = segments.join('/');

  let currentDir = root;

  for (let i = 0; i < dirSegments.length; i++) {
    const seg = dirSegments[i];
    const partialPath = segments.slice(0, i + 1).join('/');
    const result = await getDirectoryHandleCaseInsensitive(currentDir, seg, partialPath, isCancelled);
    if ('error' in result) return { ok: false, error: result.error };
    currentDir = result.handle;
  }

  if (isCancelled?.()) return cancelledResult();
  const fileResult = await getFileHandleCaseInsensitive(currentDir, fileName, fullPath, isCancelled);
  if ('error' in fileResult) return { ok: false, error: fileResult.error };

  try {
    const file = await fileResult.handle.getFile();
    if (isCancelled?.()) return cancelledResult();
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: mapDomException(err, fullPath, fileName) };
  }
}

const REKORDBOX_INDICATORS = ['PIONEER', 'Contents', 'Music'] as const;

// ── USB root check (discriminated) ───────────────────────────────────────────

/**
 * Discriminated result of `checkRekordboxStructure`.
 * Callers must use the `status` field to route state — never conflate
 * permission errors or I/O failures with folder-absence.
 */
export type UsbRootCheck =
  | {
      status: 'available';
      foundFolders: string[];
      missingFolders: string[];
    }
  | {
      /** Permission was revoked mid-session. User gesture required to re-grant. */
      status: 'permission_required';
    }
  | {
      /** Drive is physically absent or an unrecoverable I/O error occurred. */
      status: 'unavailable';
      errorCode: string;
      message: string;
    }
  | {
      /** Drive is accessible but the selected folder is not the USB root. */
      status: 'wrong_root';
      foundFolders: string[];
      missingFolders: string[];
    };

/**
 * Check whether `root` is accessible and contains expected Rekordbox folders.
 *
 * Distinguishes between:
 *   - Folder genuinely absent (NotFoundError → counted as missing)
 *   - Permission revoked (NotAllowedError → permission_required)
 *   - Physical unplug / I/O error (other DOMException → unavailable)
 *   - Correct USB root with optional partial structure (available)
 *   - Wrong folder selected — no Rekordbox folders at all (wrong_root)
 */
export async function checkRekordboxStructure(
  root: FileSystemDirectoryHandle,
): Promise<UsbRootCheck> {
  const found: string[] = [];
  const missing: string[] = [];

  for (const name of REKORDBOX_INDICATORS) {
    try {
      await root.getDirectoryHandle(name);
      found.push(name);
    } catch (err) {
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotFoundError':
            // Folder is genuinely absent — not an I/O error.
            missing.push(name);
            break;
          case 'NotAllowedError':
            // Permission was revoked between the queryPermission call and now.
            return { status: 'permission_required' };
          case 'SecurityError':
            return {
              status: 'unavailable',
              errorCode: 'security',
              message: 'A browser security policy blocked USB access.',
            };
          default:
            // AbortError, InvalidStateError, or platform I/O error — USB gone.
            return {
              status: 'unavailable',
              errorCode: err.name,
              message: `USB access error (${err.name}).`,
            };
        }
      } else {
        // Non-DOMException — unexpected runtime error.
        return {
          status: 'unavailable',
          errorCode: 'io_error',
          message: String(err),
        };
      }
    }
  }

  // No Rekordbox folders found at all — likely the wrong directory.
  if (found.length === 0) {
    return {
      status: 'wrong_root',
      foundFolders: [],
      missingFolders: [...REKORDBOX_INDICATORS],
    };
  }

  return { status: 'available', foundFolders: found, missingFolders: missing };
}
