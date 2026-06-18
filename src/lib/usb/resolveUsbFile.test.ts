import { describe, expect, it, vi } from 'vitest';
import { resolveUsbFile, checkRekordboxStructure, type UsbFileResult, type UsbFileResolutionError } from './resolveUsbFile';

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
    [Symbol.asyncIterator]: vi.fn(),
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

// ── checkRekordboxStructure ────────────────────────────────────────────────────

describe('checkRekordboxStructure', () => {
  it('reports all found when all indicators present', async () => {
    const root = makeDir('USB', {
      dirs: { PIONEER: {}, Contents: {}, Music: {} },
    });
    const { found, missing } = await checkRekordboxStructure(root);
    expect(found).toEqual(['PIONEER', 'Contents', 'Music']);
    expect(missing).toEqual([]);
  });

  it('reports missing folders when structure is absent', async () => {
    const root = makeDir('Downloads', {});
    const { found, missing } = await checkRekordboxStructure(root);
    expect(found).toEqual([]);
    expect(missing).toEqual(['PIONEER', 'Contents', 'Music']);
  });

  it('reports partial match correctly', async () => {
    const root = makeDir('USB', { dirs: { PIONEER: {} } });
    const { found, missing } = await checkRekordboxStructure(root);
    expect(found).toContain('PIONEER');
    expect(missing).toContain('Contents');
    expect(missing).toContain('Music');
  });
});
