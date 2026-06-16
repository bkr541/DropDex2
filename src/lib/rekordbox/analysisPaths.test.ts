import { describe, expect, it } from 'vitest';
import {
  extractManifestPaths,
  findDatabaseFile,
  getCanonicalAnlzPath,
  isAnlzFile,
  isSafePath,
  matchFilesToManifest,
  normalizeAnlzPath,
} from './analysisPaths';

// ── helpers ───────────────────────────────────────────────────────────────────

function mockFile(name: string, webkitRelativePath = ''): File {
  return { name, webkitRelativePath, size: 100, type: '' } as unknown as File;
}

// ── normalizeAnlzPath ─────────────────────────────────────────────────────────

describe('normalizeAnlzPath', () => {
  it('accepts a normal DAT path', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/ANLZ0000.DAT')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    ));

  it('accepts EXT extension', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/ANLZ0000.EXT')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.EXT',
    ));

  it('accepts 2EX extension', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/ANLZ0000.2EX')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.2EX',
    ));

  it('accepts lowercase extension', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/ANLZ0000.dat')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.dat',
    ));

  it('converts backslashes to forward slashes', () =>
    expect(normalizeAnlzPath('PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    ));

  it('strips leading slashes', () =>
    expect(normalizeAnlzPath('/PIONEER/USBANLZ/P001/ANLZ0000.DAT')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    ));

  it('strips multiple leading slashes', () =>
    expect(normalizeAnlzPath('//PIONEER/USBANLZ/P001/ANLZ0000.DAT')).toBe(
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    ));

  it('rejects dot-dot traversal', () =>
    expect(normalizeAnlzPath('PIONEER/../USBANLZ/P001/ANLZ0000.DAT')).toBeNull());

  it('rejects traversal at root', () =>
    expect(normalizeAnlzPath('../etc/passwd')).toBeNull());

  it('rejects a .mp3 extension', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/TRACK.mp3')).toBeNull());

  it('rejects a .db extension', () =>
    expect(normalizeAnlzPath('PIONEER/rekordbox/exportLibrary.db')).toBeNull());

  it('rejects empty string', () =>
    expect(normalizeAnlzPath('')).toBeNull());

  it('rejects path with no extension', () =>
    expect(normalizeAnlzPath('PIONEER/USBANLZ/P001/ANLZ0000')).toBeNull());
});

// ── isSafePath ────────────────────────────────────────────────────────────────

describe('isSafePath', () => {
  it('accepts a clean relative path', () =>
    expect(isSafePath('PIONEER/USBANLZ/P001/ANLZ0000.DAT')).toBe(true));

  it('accepts a filename with no directory', () =>
    expect(isSafePath('ANLZ0000.DAT')).toBe(true));

  it('rejects absolute path', () =>
    expect(isSafePath('/etc/passwd')).toBe(false));

  it('rejects path with double-dot segment', () =>
    expect(isSafePath('PIONEER/../secret')).toBe(false));

  it('rejects double-dot at start', () =>
    expect(isSafePath('../etc/passwd')).toBe(false));

  it('rejects empty string', () =>
    expect(isSafePath('')).toBe(false));

  it('accepts backslash path (converted internally)', () =>
    expect(isSafePath('PIONEER\\USBANLZ\\P001')).toBe(true));

  it('rejects backslash traversal', () =>
    expect(isSafePath('PIONEER\\..\\secret')).toBe(false));
});

// ── getCanonicalAnlzPath ──────────────────────────────────────────────────────

describe('getCanonicalAnlzPath', () => {
  it('extracts PIONEER-anchored path from typical USB layout', () => {
    const f = mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBe('PIONEER/USBANLZ/P001/ANLZ0000.DAT');
  });

  it('extracts path when anchor is at root of relPath', () => {
    const f = mockFile('ANLZ0000.DAT', 'PIONEER/USBANLZ/P001/ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBe('PIONEER/USBANLZ/P001/ANLZ0000.DAT');
  });

  it('handles mixed-case PIONEER anchor', () => {
    const f = mockFile('ANLZ0000.DAT', 'drive/pioneer/usbanlz/P001/ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBe('pioneer/usbanlz/P001/ANLZ0000.DAT');
  });

  it('accepts EXT extension', () => {
    const f = mockFile('ANLZ0000.EXT', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.EXT');
    expect(getCanonicalAnlzPath(f)).toBe('PIONEER/USBANLZ/P001/ANLZ0000.EXT');
  });

  it('accepts 2EX extension', () => {
    const f = mockFile('ANLZ0000.2EX', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.2EX');
    expect(getCanonicalAnlzPath(f)).toBe('PIONEER/USBANLZ/P001/ANLZ0000.2EX');
  });

  it('returns null when webkitRelativePath is empty', () => {
    const f = mockFile('ANLZ0000.DAT', '');
    expect(getCanonicalAnlzPath(f)).toBeNull();
  });

  it('returns null when webkitRelativePath is absent', () => {
    const f = { name: 'ANLZ0000.DAT', size: 0, type: '' } as unknown as File;
    expect(getCanonicalAnlzPath(f)).toBeNull();
  });

  it('returns null when PIONEER/USBANLZ anchor is not found', () => {
    const f = mockFile('ANLZ0000.DAT', 'OTHER_FOLDER/P001/ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBeNull();
  });

  it('returns null for non-ANLZ extension after anchor', () => {
    const f = mockFile('track.mp3', 'USB/PIONEER/USBANLZ/P001/track.mp3');
    expect(getCanonicalAnlzPath(f)).toBeNull();
  });

  it('returns null when traversal present in relative path', () => {
    const f = mockFile('ANLZ0000.DAT', 'USB/PIONEER/USBANLZ/../../../etc/ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBeNull();
  });

  it('converts backslashes in webkitRelativePath', () => {
    const f = mockFile('ANLZ0000.DAT', 'USB\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT');
    expect(getCanonicalAnlzPath(f)).toBe('PIONEER/USBANLZ/P001/ANLZ0000.DAT');
  });
});

// ── isAnlzFile ────────────────────────────────────────────────────────────────

describe('isAnlzFile', () => {
  it('returns true for .dat', () => expect(isAnlzFile(mockFile('ANLZ0000.DAT'))).toBe(true));
  it('returns true for .ext', () => expect(isAnlzFile(mockFile('ANLZ0000.EXT'))).toBe(true));
  it('returns true for .2ex', () => expect(isAnlzFile(mockFile('ANLZ0000.2EX'))).toBe(true));
  it('returns true for lowercase .dat', () => expect(isAnlzFile(mockFile('anlz0000.dat'))).toBe(true));
  it('returns false for .mp3', () => expect(isAnlzFile(mockFile('track.mp3'))).toBe(false));
  it('returns false for .db', () => expect(isAnlzFile(mockFile('exportLibrary.db'))).toBe(false));
  it('returns false for file with no extension', () => expect(isAnlzFile(mockFile('ANLZ0000'))).toBe(false));
});

// ── findDatabaseFile ──────────────────────────────────────────────────────────

describe('findDatabaseFile', () => {
  it('finds exportLibrary.db by exact name', () => {
    const files = [mockFile('ANLZ0000.DAT'), mockFile('exportLibrary.db'), mockFile('other.txt')];
    expect(findDatabaseFile(files)).toBe(files[1]);
  });

  it('finds exportLibrary.db case-insensitively', () => {
    const files = [mockFile('EXPORTLIBRARY.DB')];
    expect(findDatabaseFile(files)?.name).toBe('EXPORTLIBRARY.DB');
  });

  it('returns null when no db file present', () => {
    const files = [mockFile('ANLZ0000.DAT'), mockFile('README.txt')];
    expect(findDatabaseFile(files)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findDatabaseFile([])).toBeNull();
  });
});

// ── extractManifestPaths ──────────────────────────────────────────────────────

describe('extractManifestPaths', () => {
  it('extracts all three path types', () => {
    const manifest = [
      { dat_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', ext_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', two_ex_path: 'PIONEER/USBANLZ/P001/ANLZ0000.2EX' },
    ];
    expect(extractManifestPaths(manifest)).toEqual([
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
      'PIONEER/USBANLZ/P001/ANLZ0000.EXT',
      'PIONEER/USBANLZ/P001/ANLZ0000.2EX',
    ]);
  });

  it('omits null paths', () => {
    const manifest = [
      { dat_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', ext_path: null, two_ex_path: null },
    ];
    expect(extractManifestPaths(manifest)).toEqual(['PIONEER/USBANLZ/P001/ANLZ0000.DAT']);
  });

  it('handles multiple manifest entries', () => {
    const manifest = [
      { dat_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', ext_path: null, two_ex_path: null },
      { dat_path: 'PIONEER/USBANLZ/P002/ANLZ0000.DAT', ext_path: null, two_ex_path: null },
    ];
    expect(extractManifestPaths(manifest)).toHaveLength(2);
  });

  it('returns empty array for empty manifest', () => {
    expect(extractManifestPaths([])).toEqual([]);
  });
});

// ── matchFilesToManifest ──────────────────────────────────────────────────────

describe('matchFilesToManifest', () => {
  it('matches a file by canonical path', () => {
    const f = mockFile('ANLZ0000.DAT', 'MY_USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT');
    const result = matchFilesToManifest([f], ['PIONEER/USBANLZ/P001/ANLZ0000.DAT']);
    expect(result.size).toBe(1);
    expect(result.get('pioneer/usbanlz/p001/anlz0000.dat')).toBe(f);
  });

  it('matching is case-insensitive against manifest paths', () => {
    const f = mockFile('ANLZ0000.DAT', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT');
    const result = matchFilesToManifest([f], ['pioneer/usbanlz/p001/anlz0000.dat']);
    expect(result.size).toBe(1);
  });

  it('excludes files not in the manifest', () => {
    const f = mockFile('ANLZ0001.DAT', 'USB/PIONEER/USBANLZ/P002/ANLZ0001.DAT');
    const result = matchFilesToManifest([f], ['PIONEER/USBANLZ/P001/ANLZ0000.DAT']);
    expect(result.size).toBe(0);
  });

  it('excludes non-ANLZ files', () => {
    const f = mockFile('exportLibrary.db', 'USB/PIONEER/rekordbox/exportLibrary.db');
    const result = matchFilesToManifest([f], ['PIONEER/rekordbox/exportLibrary.db']);
    expect(result.size).toBe(0);
  });

  it('excludes files without PIONEER/USBANLZ anchor', () => {
    const f = mockFile('ANLZ0000.DAT', 'USB/OTHER_FOLDER/P001/ANLZ0000.DAT');
    const result = matchFilesToManifest([f], ['OTHER_FOLDER/P001/ANLZ0000.DAT']);
    expect(result.size).toBe(0);
  });

  it('matches multiple files from a batch', () => {
    const files = [
      mockFile('ANLZ0000.DAT', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      mockFile('ANLZ0000.EXT', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
      mockFile('unrelated.mp3', 'USB/music/unrelated.mp3'),
    ];
    const manifest = [
      'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
      'PIONEER/USBANLZ/P001/ANLZ0000.EXT',
    ];
    const result = matchFilesToManifest(files, manifest);
    expect(result.size).toBe(2);
  });

  it('returns empty map when manifest is empty', () => {
    const f = mockFile('ANLZ0000.DAT', 'USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT');
    expect(matchFilesToManifest([f], []).size).toBe(0);
  });

  it('returns empty map when files array is empty', () => {
    expect(matchFilesToManifest([], ['PIONEER/USBANLZ/P001/ANLZ0000.DAT']).size).toBe(0);
  });
});
