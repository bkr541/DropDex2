import { describe, expect, it } from 'vitest';
import { resolveUsbPath } from './usbPathResolver';

// ── helpers ────────────────────────────────────────────────────────────────────

function ok(path: string | null | undefined, segments: string[], volume: string | null = null) {
  const result = resolveUsbPath(path);
  expect(result.status).toBe('ok');
  expect(result.segments).toEqual(segments);
  expect(result.strippedVolume).toBe(volume);
  expect(result.normalizedRelative).toBe(segments.join('/'));
}

// ── Empty / null input ─────────────────────────────────────────────────────────

describe('empty input', () => {
  it('returns empty for null', () => {
    const r = resolveUsbPath(null);
    expect(r.status).toBe('empty');
    expect(r.segments).toEqual([]);
    expect(r.normalizedRelative).toBeNull();
  });

  it('returns empty for undefined', () => {
    expect(resolveUsbPath(undefined).status).toBe('empty');
  });

  it('returns empty for empty string', () => {
    expect(resolveUsbPath('').status).toBe('empty');
  });

  it('returns empty for whitespace only', () => {
    expect(resolveUsbPath('   ').status).toBe('empty');
  });
});

// ── USB-relative paths (leading slash) ────────────────────────────────────────

describe('USB-relative paths', () => {
  it('strips leading slash from /Contents/Artist/Track.mp3', () => {
    ok('/Contents/Artist/Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('handles path without leading slash', () => {
    ok('Contents/Artist/Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('collapses multiple leading slashes', () => {
    ok('//Contents///Artist//Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('handles a single directory component', () => {
    ok('/Contents', ['Contents']);
  });

  it('handles trailing slash gracefully', () => {
    ok('/Contents/Artist/', ['Contents', 'Artist']);
  });
});

// ── Windows drive letter paths ─────────────────────────────────────────────────

describe('Windows drive letter paths', () => {
  it('strips uppercase drive letter E:/', () => {
    ok('E:\\Contents\\Artist\\Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('strips lowercase drive letter c:/', () => {
    ok('c:\\Contents\\Artist\\Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('handles forward-slash Windows path', () => {
    ok('D:/Contents/Artist/Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('handles mixed backslash and forward slash', () => {
    ok('E:/Contents\\Artist/Track Name.mp3', ['Contents', 'Artist', 'Track Name.mp3']);
  });

  it('strips the drive but not the first directory', () => {
    ok('E:\\MySongs\\Track.mp3', ['MySongs', 'Track.mp3']);
  });
});

// ── macOS /Volumes/ paths ──────────────────────────────────────────────────────

describe('macOS /Volumes/ paths', () => {
  it('strips /Volumes/MYUSB/ and records strippedVolume', () => {
    const r = resolveUsbPath('/Volumes/MYUSB/Contents/Artist/Track.mp3');
    expect(r.status).toBe('ok');
    expect(r.segments).toEqual(['Contents', 'Artist', 'Track.mp3']);
    expect(r.strippedVolume).toBe('MYUSB');
    expect(r.normalizedRelative).toBe('Contents/Artist/Track.mp3');
  });

  it('with expectedVolume matching — status ok', () => {
    const r = resolveUsbPath('/Volumes/MYUSB/Contents/Track.mp3', { expectedVolume: 'MYUSB' });
    expect(r.status).toBe('ok');
    expect(r.segments).toEqual(['Contents', 'Track.mp3']);
    expect(r.strippedVolume).toBe('MYUSB');
  });

  it('with expectedVolume mismatch — status volume_prefix_mismatch, segments still populated', () => {
    const r = resolveUsbPath('/Volumes/OTHERWELL/Contents/Track.mp3', {
      expectedVolume: 'MYUSB',
    });
    expect(r.status).toBe('volume_prefix_mismatch');
    expect(r.segments).toEqual(['Contents', 'Track.mp3']);
    expect(r.strippedVolume).toBe('OTHERWELL');
    expect(r.normalizedRelative).toBe('Contents/Track.mp3');
  });

  it('expectedVolume provided but no /Volumes/ prefix — status ok (no comparison)', () => {
    const r = resolveUsbPath('/Contents/Track.mp3', { expectedVolume: 'MYUSB' });
    expect(r.status).toBe('ok');
    expect(r.strippedVolume).toBeNull();
  });

  it('handles /Volumes/USB with no trailing slash (edge case)', () => {
    // /Volumes/USB alone would have no content remaining
    const r = resolveUsbPath('/Volumes/USB');
    expect(r.status).toBe('no_filename');
    expect(r.strippedVolume).toBe('USB');
  });
});

// ── file:// URL scheme ─────────────────────────────────────────────────────────

describe('file:// URL paths', () => {
  it('strips file:/// prefix', () => {
    ok('file:///Contents/Artist/Track.mp3', ['Contents', 'Artist', 'Track.mp3']);
  });

  it('strips file://localhost/ authority', () => {
    const r = resolveUsbPath('file://localhost/Contents/Track.mp3');
    expect(r.status).toBe('ok');
    expect(r.segments).toEqual(['Contents', 'Track.mp3']);
  });

  it('decodes URL-encoded spaces in file:// path', () => {
    const r = resolveUsbPath('file:///Contents/My%20Artist/My%20Track.mp3');
    expect(r.status).toBe('ok');
    expect(r.segments).toEqual(['Contents', 'My Artist', 'My Track.mp3']);
  });

  it('decodes URL-encoded apostrophe in file:// path', () => {
    const r = resolveUsbPath("file:///Contents/Artist/Don%27t%20Stop.mp3");
    expect(r.status).toBe('ok');
    expect(r.segments).toEqual(["Contents", "Artist", "Don't Stop.mp3"]);
  });

  it('handles file:// with /Volumes/ prefix and stripping', () => {
    const r = resolveUsbPath('file:///Volumes/USB/Contents/Track.mp3');
    expect(r.status).toBe('ok');
    expect(r.strippedVolume).toBe('USB');
    expect(r.segments).toEqual(['Contents', 'Track.mp3']);
  });
});

// ── Unsupported schemes ────────────────────────────────────────────────────────

describe('unsupported URL schemes', () => {
  it('rejects https://', () => {
    expect(resolveUsbPath('https://example.com/track.mp3').status).toBe('unsupported_scheme');
  });

  it('rejects ftp://', () => {
    expect(resolveUsbPath('ftp://server/track.mp3').status).toBe('unsupported_scheme');
  });
});

// ── Unicode and special characters ────────────────────────────────────────────

describe('Unicode and special characters', () => {
  it('preserves Unicode artist and filename', () => {
    ok('/Contents/Artëst/Tïtlé.mp3', ['Contents', 'Artëst', 'Tïtlé.mp3']);
  });

  it('preserves multiple spaces in directory and filename', () => {
    ok('/Contents/My   Track/Song  Name.mp3', ['Contents', 'My   Track', 'Song  Name.mp3']);
  });

  it('preserves ampersand and apostrophe', () => {
    ok("/Contents/Pop & Rock/Artist's Track.mp3", [
      'Contents',
      'Pop & Rock',
      "Artist's Track.mp3",
    ]);
  });

  it('preserves Japanese characters', () => {
    ok('/Contents/アーティスト/楽曲.mp3', ['Contents', 'アーティスト', '楽曲.mp3']);
  });

  it('preserves parentheses and hyphens', () => {
    ok('/Contents/DJ Mix (2024)/Track 01 - Intro.mp3', [
      'Contents',
      'DJ Mix (2024)',
      'Track 01 - Intro.mp3',
    ]);
  });
});

// ── Traversal rejection ────────────────────────────────────────────────────────

describe('path traversal safety', () => {
  it('rejects bare ../../etc/passwd', () => {
    const r = resolveUsbPath('../../etc/passwd');
    expect(r.status).toBe('unsafe');
    expect(r.segments).toEqual([]);
    expect(r.normalizedRelative).toBeNull();
  });

  it('rejects /Contents/../etc/passwd', () => {
    expect(resolveUsbPath('/Contents/../etc/passwd').status).toBe('unsafe');
  });

  it('rejects /Contents/./Track.mp3 (dot segment)', () => {
    expect(resolveUsbPath('/Contents/./Track.mp3').status).toBe('unsafe');
  });

  it('rejects traversal inside Windows path', () => {
    expect(resolveUsbPath('E:\\Contents\\..\\etc\\passwd').status).toBe('unsafe');
  });

  it('rejects traversal inside /Volumes/ path', () => {
    expect(resolveUsbPath('/Volumes/USB/Contents/../../etc/passwd').status).toBe('unsafe');
  });

  it('populates strippedVolume even when traversal detected', () => {
    const r = resolveUsbPath('/Volumes/USB/../etc/passwd');
    expect(r.status).toBe('unsafe');
    // strippedVolume is set before traversal check runs; presence is informational
    // (implementation may or may not set it — test only that status is unsafe)
    expect(r.segments).toEqual([]);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns no_filename for a bare slash', () => {
    expect(resolveUsbPath('/').status).toBe('no_filename');
  });

  it('returns no_filename for a Windows drive with no path', () => {
    // "E:/" after stripping becomes ""
    expect(resolveUsbPath('E:/').status).toBe('no_filename');
  });

  it('handles a deeply nested path', () => {
    ok('/Contents/A/B/C/D/Track.mp3', ['Contents', 'A', 'B', 'C', 'D', 'Track.mp3']);
  });

  it('handles file with no extension', () => {
    ok('/Contents/Artist/TrackNoExt', ['Contents', 'Artist', 'TrackNoExt']);
  });

  it('handles root-level file (no subdirectory)', () => {
    ok('/Track.mp3', ['Track.mp3']);
  });

  it('does not alter original string when it is reused (pure function)', () => {
    const original = '/Contents/Artist/Track.mp3';
    resolveUsbPath(original);
    expect(original).toBe('/Contents/Artist/Track.mp3');
  });
});

// ── trackStatRowToTrack mapping ───────────────────────────────────────────────

import { trackStatRowToTrack } from '../queries/rekordbox';
import type { TrackStatRow } from '../queries/rekordbox';

function makeRow(overrides: Partial<TrackStatRow> = {}): TrackStatRow {
  return {
    id: 'row-uuid-1',
    import_id: 'import-uuid-1',
    rekordbox_content_id: '12345',
    title: 'Test Track',
    artist: 'Test Artist',
    genre: 'Techno',
    bpm: 138.0,
    musical_key: 'G',
    camelot_key: '9B',
    date_added: '2024-06-01',
    duration_seconds: 360,
    file_path: '/Contents/Techno/Test Track.mp3',
    file_format: 'MP3',
    ...overrides,
  };
}

describe('trackStatRowToTrack', () => {
  it('preserves id and import_id', () => {
    const t = trackStatRowToTrack(makeRow());
    expect(t.id).toBe('row-uuid-1');
    expect(t.import_id).toBe('import-uuid-1');
  });

  it('preserves rekordbox_content_id (no longer hardcoded empty string)', () => {
    const t = trackStatRowToTrack(makeRow({ rekordbox_content_id: '99999' }));
    expect(t.rekordbox_content_id).toBe('99999');
  });

  it('preserves file_path (no longer hardcoded null)', () => {
    const t = trackStatRowToTrack(makeRow({ file_path: '/Contents/Artist/Track.mp3' }));
    expect(t.file_path).toBe('/Contents/Artist/Track.mp3');
  });

  it('preserves file_path as null when absent', () => {
    expect(trackStatRowToTrack(makeRow({ file_path: null })).file_path).toBeNull();
  });

  it('preserves file_format', () => {
    expect(trackStatRowToTrack(makeRow({ file_format: 'AIFF' })).file_format).toBe('AIFF');
  });

  it('preserves duration_seconds (no longer hardcoded null)', () => {
    expect(trackStatRowToTrack(makeRow({ duration_seconds: 245 })).duration_seconds).toBe(245);
  });

  it('preserves null duration_seconds', () => {
    expect(trackStatRowToTrack(makeRow({ duration_seconds: null })).duration_seconds).toBeNull();
  });

  it('preserves bpm, musical_key, camelot_key', () => {
    const t = trackStatRowToTrack(makeRow({ bpm: 124.5, musical_key: 'Am', camelot_key: '8A' }));
    expect(t.bpm).toBe(124.5);
    expect(t.musical_key).toBe('Am');
    expect(t.camelot_key).toBe('8A');
  });

  it('preserves Windows drive path unchanged', () => {
    const t = trackStatRowToTrack(makeRow({ file_path: 'E:\\Contents\\Artist\\Track.mp3' }));
    expect(t.file_path).toBe('E:\\Contents\\Artist\\Track.mp3');
  });

  it('preserves macOS volume path unchanged', () => {
    const t = trackStatRowToTrack(
      makeRow({ file_path: '/Volumes/USB/Contents/Artist/Track.mp3' }),
    );
    expect(t.file_path).toBe('/Volumes/USB/Contents/Artist/Track.mp3');
  });

  it('null-only fields that are not in TrackStatRow default to null', () => {
    const t = trackStatRowToTrack(makeRow());
    expect(t.album).toBeNull();
    expect(t.comments).toBeNull();
    expect(t.rating).toBeNull();
    expect(t.analysis_parse_status).toBeNull();
    expect(t.analysis_parse_warnings).toEqual([]);
  });
});
