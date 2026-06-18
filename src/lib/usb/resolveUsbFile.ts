export type UsbFileResolutionError =
  | { kind: 'not_found'; path: string; message: string }
  | { kind: 'permission_denied'; message: string }
  | { kind: 'type_mismatch'; segment: string; message: string }
  | { kind: 'abort'; message: string }
  | { kind: 'security'; message: string }
  | { kind: 'unexpected'; message: string };

export type UsbFileResult =
  | { ok: true; file: File }
  | { ok: false; error: UsbFileResolutionError };

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
 * Traverse a FileSystemDirectoryHandle tree and return the File at the given
 * path segments rooted at `root`.
 *
 * Privacy: returns an in-memory File object only. Callers must not persist,
 * upload, cache, or copy the file's contents.
 */
export async function resolveUsbFile(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<UsbFileResult> {
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

  for (const seg of dirSegments) {
    try {
      currentDir = await currentDir.getDirectoryHandle(seg);
    } catch (err) {
      return { ok: false, error: mapDomException(err, fullPath, seg) };
    }
  }

  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await currentDir.getFileHandle(fileName);
  } catch (err) {
    return { ok: false, error: mapDomException(err, fullPath, fileName) };
  }

  try {
    const file = await fileHandle.getFile();
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: mapDomException(err, fullPath, fileName) };
  }
}

const REKORDBOX_INDICATORS = ['PIONEER', 'Contents', 'Music'] as const;

/**
 * Non-blocking check for expected Rekordbox USB folder structure.
 * Used to warn the user if they selected the wrong directory.
 */
export async function checkRekordboxStructure(
  root: FileSystemDirectoryHandle,
): Promise<{ found: string[]; missing: string[] }> {
  const found: string[] = [];
  const missing: string[] = [];
  for (const name of REKORDBOX_INDICATORS) {
    try {
      await root.getDirectoryHandle(name);
      found.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { found, missing };
}
