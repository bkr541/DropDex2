import { describe, expect, it, vi } from 'vitest';
import { resolveUsbFile, checkRekordboxStructure, type UsbFileResult, type UsbFileResolutionError, type UsbRootCheck } from './resolveUsbFile';

// ── helpers ────────────────────────────────────────────────────────────────────

// Without strictNullChecks, TypeScript can't narrow discriminated unions on `ok`.
// Use this type guard to access the error branch with correct types.
function isErrorResult(r: UsbFileResult): r is { ok: false; error: UsbFileResolutionError } {
  return !r.ok;
}

function makeFile(name: string): File {
  return new File(['audio-data'], name, { type: 'audio/mpeg' });
}

function makeFileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    getFile: vi.fn().mockResolvedValue(file),
  } as unknown as FileSystemFileHandle;
}

type DirTree = {
  files?: Record<string, File>;
  dirs?: Record<string, DirTree>;
};

function makeDir(name: string, tree: DirTree): FileSystemDirectoryHandle {
  // Async iterator that yields [name, handle] pairs for dirs and files.
  async function* makeAsyncIterator(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
    for (const [dirName, subtree] of Object.entries(tree.dirs ?? {})) {
      yield [dirName, makeDir(dirName, subtree)];
    }
    for (const [fileName, file] of Object.entries(tree.files ?? {})) {
      yield [fileName, makeFileHandle(file)];
    }
  }

  return {
    kind: 'directory',
    name,
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    getDirectoryHandle: vi.fn(async (seg: string) => {
      if (tree.dirs && seg in tree.dirs) return makeDir(seg, tree.dirs[seg]);
      throw new DOMException(`${seg} not found`, 'NotFoundError');
    }),
    getFileHandle: vi.fn(async (seg: string) => {
      if (tree.files && seg in tree.files) return makeFileHandle(tree.files[seg]);
      throw new DOMException(`${seg} not found`, 'NotFoundError');
    }),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    [Symbol.asyncIterator]: makeAsyncIterator,
    entries: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;
}

// ── resolveUsbFile ─────────────────────────────────────────────────────────────

describe('resolveUsbFile — edge cases', () => {
  it('returns not_found for empty segments', async () => {
    const root = makeDir('USB', {});
    const result = await resolveUsbFile(root, []);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('not_found');
  });

  it('returns not_found when file does not exist at root', async () => {
    const root = makeDir('USB', {});
    const result = await resolveUsbFile(root, ['missing.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) {
      expect(result.error.kind).toBe('not_found');
    }
  });
});

describe('resolveUsbFile — nested directory resolution', () => {
  it('resolves a flat file at the root', async () => {
    const file = makeFile('Track.mp3');
    const root = makeDir('USB', { files: { 'Track.mp3': file } });
    const result = await resolveUsbFile(root, ['Track.mp3']);
    expect(result.ok).toBe(true);
    if (!isErrorResult(result)) expect(result.file).toBe(file);
  });

  it('resolves a file nested two directories deep', async () => {
    const file = makeFile('Song.aiff');
    const root = makeDir('USB', {
      dirs: {
        Contents: {
          dirs: {
            Artist: {
              files: { 'Song.aiff': file },
            },
          },
        },
      },
    });
    const result = await resolveUsbFile(root, ['Contents', 'Artist', 'Song.aiff']);
    expect(result.ok).toBe(true);
    if (!isErrorResult(result)) expect(result.file.name).toBe('Song.aiff');
  });

  it('resolves using a single segment (file at root)', async () => {
    const file = makeFile('Intro.mp3');
    const root = makeDir('USB', { files: { 'Intro.mp3': file } });
    const result = await resolveUsbFile(root, ['Intro.mp3']);
    expect(result.ok).toBe(true);
  });
});

describe('resolveUsbFile — missing file', () => {
  it('returns not_found when the file does not exist', async () => {
    const root = makeDir('USB', { dirs: { Contents: {} } });
    const result = await resolveUsbFile(root, ['Contents', 'ghost.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) {
      expect(result.error.kind).toBe('not_found');
      const notFound = result.error as { kind: 'not_found'; path: string };
      expect(notFound.path).toBe('Contents/ghost.mp3');
    }
  });

  it('returns not_found when a directory segment is missing', async () => {
    const root = makeDir('USB', {});
    const result = await resolveUsbFile(root, ['NoSuchDir', 'Track.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('not_found');
  });
});

describe('resolveUsbFile — permission denied', () => {
  it('maps NotAllowedError to permission_denied', async () => {
    const root = makeDir('USB', {});
    (root.getFileHandle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException('No permission', 'NotAllowedError'),
    );
    const result = await resolveUsbFile(root, ['Track.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('permission_denied');
  });
});

describe('resolveUsbFile — unplugged drive / I/O error', () => {
  it('maps SecurityError to security kind', async () => {
    const root = makeDir('USB', {});
    (root.getFileHandle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException('Security error', 'SecurityError'),
    );
    const result = await resolveUsbFile(root, ['Track.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('security');
  });

  it('maps unknown DOMException to unexpected kind', async () => {
    const root = makeDir('USB', {});
    (root.getFileHandle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException('Unknown', 'UnknownError'),
    );
    const result = await resolveUsbFile(root, ['Track.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('unexpected');
  });
});

describe('resolveUsbFile — wrong directory selected', () => {
  it('returns not_found for each expected structure folder when wrong dir', async () => {
    const root = makeDir('Downloads', {}); // wrong dir selected
    const result = await resolveUsbFile(root, ['Contents', 'Artist', 'Track.mp3']);
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('not_found');
  });
});

describe('resolveUsbFile — no audio persistence', () => {
  it('does not cache the file — each call traverses the handle tree', async () => {
    const file = makeFile('Track.mp3');
    const root = makeDir('USB', { files: { 'Track.mp3': file } });
    const result1 = await resolveUsbFile(root, ['Track.mp3']);
    const result2 = await resolveUsbFile(root, ['Track.mp3']);
    // Each call must call getFileHandle — no internal cache that could retain audio data
    expect(root.getFileHandle).toHaveBeenCalledTimes(2);
    expect(result1.ok && result2.ok).toBe(true);
  });
});



describe('resolveUsbFile — cooperative cancellation', () => {
  it('returns abort before touching the directory tree when superseded', async () => {
    const root = makeDir('USB', { files: { 'Track.mp3': makeFile('Track.mp3') } });
    const result = await resolveUsbFile(root, ['Track.mp3'], { isCancelled: () => true });
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('abort');
    expect(root.getFileHandle).not.toHaveBeenCalled();
  });

  it('aborts after async file resolution when a newer request takes ownership', async () => {
    let cancelled = false;
    const file = makeFile('Track.mp3');
    const fileHandle = makeFileHandle(file);
    (fileHandle.getFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      cancelled = true;
      return file;
    });
    const root = makeDir('USB', {});
    (root.getFileHandle as ReturnType<typeof vi.fn>).mockResolvedValue(fileHandle);

    const result = await resolveUsbFile(root, ['Track.mp3'], { isCancelled: () => cancelled });
    expect(result.ok).toBe(false);
    if (isErrorResult(result)) expect(result.error.kind).toBe('abort');
  });
});

// ── checkRekordboxStructure (discriminated UsbRootCheck) ──────────────────────

// Helper: build a root that throws a specific DOMException for every getDirectoryHandle call.
function makeErrorRoot(exceptionName: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'USB_ROOT',
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    getDirectoryHandle: vi.fn(async () => {
      throw new DOMException('error', exceptionName);
    }),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
    entries: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;
}

describe('checkRekordboxStructure — connected root', () => {
  it('returns available with all folders found', async () => {
    const root = makeDir('USB', {
      dirs: { PIONEER: {}, Contents: {}, Music: {} },
    });
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.foundFolders).toEqual(['PIONEER', 'Contents', 'Music']);
      expect(result.missingFolders).toHaveLength(0);
    }
  });

  it('returns available with missingFolders when only PIONEER exists', async () => {
    const root = makeDir('USB', { dirs: { PIONEER: {} } });
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.foundFolders).toContain('PIONEER');
      expect(result.missingFolders).toContain('Contents');
      expect(result.missingFolders).toContain('Music');
    }
  });
});

describe('checkRekordboxStructure — wrong root', () => {
  it('returns wrong_root when all folders are NotFoundError', async () => {
    const root = makeDir('Downloads', {});
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('wrong_root');
    if (result.status === 'wrong_root') {
      expect(result.foundFolders).toHaveLength(0);
      expect(result.missingFolders).toHaveLength(3);
    }
  });
});

describe('checkRekordboxStructure — permission required', () => {
  it('returns permission_required on NotAllowedError', async () => {
    const root = makeErrorRoot('NotAllowedError');
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('permission_required');
  });
});

describe('checkRekordboxStructure — USB unavailable', () => {
  it('returns unavailable on SecurityError (not swallowed as missing)', async () => {
    const root = makeErrorRoot('SecurityError');
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      // Implementation uses 'security' for the SecurityError case.
      expect(result.errorCode).toBe('security');
    }
  });

  it('returns unavailable on AbortError — not swallowed as missing folder', async () => {
    const root = makeErrorRoot('AbortError');
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('unavailable');
    // The key regression: previously AbortError would push name to `missing[]`.
    // Post-fix, this must be 'unavailable', never 'available' or 'wrong_root'.
    expect(result.status).not.toBe('available');
    expect(result.status).not.toBe('wrong_root');
  });

  it('returns unavailable on non-DOMException I/O error', async () => {
    const root = makeDir('USB', {});
    (root.getDirectoryHandle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('I/O error reading USB'),
    );
    const result = await checkRekordboxStructure(root);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.errorCode).toBe('io_error');
    }
  });
});

describe('checkRekordboxStructure — UsbRootCheck type narrowing', () => {
  it('permission_required has no extra fields to accidentally read', () => {
    const c: UsbRootCheck = { status: 'permission_required' };
    expect(c.status).toBe('permission_required');
  });

  it('unavailable always carries errorCode and message', () => {
    const c: UsbRootCheck = { status: 'unavailable', errorCode: 'AbortError', message: 'gone' };
    if (c.status === 'unavailable') {
      expect(c.errorCode).toBe('AbortError');
      expect(c.message).toBe('gone');
    }
  });
});
