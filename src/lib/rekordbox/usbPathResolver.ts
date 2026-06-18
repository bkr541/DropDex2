/**
 * USB audio-file path resolver for Rekordbox-imported tracks.
 *
 * Rekordbox stores file paths in its exportLibrary.db as the absolute path on
 * the system that last analysed the track.  The three common variants are:
 *
 *   Windows USB    E:\Contents\Artist\Track.mp3
 *   macOS USB      /Volumes/PIONEER_USB/Contents/Artist/Track.mp3
 *   USB-relative   /Contents/Artist/Track.mp3   (leading slash, no drive)
 *
 * The importer writes the raw value from `c.path` into `rekordbox_tracks.file_path`
 * unchanged.  This module normalises those raw values into a platform-independent
 * array of path segments rooted at the USB content folder, suitable for
 * constructing a File System Access API path or a Web File picker path.
 *
 * No Supabase dependency — safe to test in Node environments.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type UsbPathStatus =
  /** Path resolved cleanly to one or more segments. */
  | 'ok'
  /** Input was null, undefined, or whitespace. */
  | 'empty'
  /** Path contains traversal segments ("." or ".."). */
  | 'unsafe'
  /** Normalised path is empty after stripping prefixes (e.g. input was just "/"). */
  | 'no_filename'
  /** URL scheme other than "file://" was detected (e.g. "https://"). */
  | 'unsupported_scheme'
  /**
   * A /Volumes/{name}/ prefix was found, but its name does not match
   * `options.expectedVolume`.  `segments` and `normalizedRelative` are still
   * populated — the caller decides whether to accept or reject.
   */
  | 'volume_prefix_mismatch';

export interface UsbPathResolution {
  status: UsbPathStatus;
  /**
   * Path segments from the USB content root, e.g.
   *   ["Contents", "Artist", "Track Name.mp3"]
   *
   * Empty when status is 'empty', 'unsafe', or 'no_filename'.
   */
  segments: string[];
  /**
   * The volume name that was stripped from a /Volumes/{name}/ prefix, if any.
   * Null when no volume prefix was present.
   */
  strippedVolume: string | null;
  /**
   * Forward-slash-joined relative path without any drive letter or volume prefix,
   * e.g. "Contents/Artist/Track Name.mp3".  Null on hard errors ('empty',
   * 'unsafe', 'no_filename', 'unsupported_scheme').
   */
  normalizedRelative: string | null;
}

export interface UsbPathOptions {
  /**
   * Expected USB volume name.  When the resolved path had a /Volumes/{name}/
   * prefix, its name is compared against this value.  A mismatch sets
   * status = 'volume_prefix_mismatch' while still populating segments.
   */
  expectedVolume?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────────

function segmentsHaveTraversal(segments: string[]): boolean {
  return segments.some((s) => s === '..' || s === '.');
}

/**
 * Normalise a raw Rekordbox `file_path` value into USB-relative path segments.
 *
 * The original `rawPath` string is never mutated; call sites should store both
 * the original and the resolved form separately.
 */
export function resolveUsbPath(
  rawPath: string | null | undefined,
  options: UsbPathOptions = {},
): UsbPathResolution {
  const EMPTY: UsbPathResolution = {
    status: 'empty',
    segments: [],
    strippedVolume: null,
    normalizedRelative: null,
  };

  // 1. Null / whitespace-only guard.
  const trimmed = rawPath?.trim() ?? '';
  if (!trimmed) return EMPTY;

  let p = trimmed;

  // 2. URL scheme detection.
  //    Only "file://" is supported.  Anything else is flagged.
  const schemeMatch = p.match(/^([A-Za-z][A-Za-z0-9+\-.]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'file') {
      // Strip "file://" prefix, then strip an optional authority component
      // (e.g. "localhost" in "file://localhost/path") which appears before
      // the first "/".  For "file:///path" the remainder already starts with
      // "/" so the replace finds no non-slash leading chars and is a no-op.
      let rest = p.slice('file://'.length);
      // Remove any non-slash prefix (the authority / hostname).
      // "localhost/path" → "/path"; "/path" → "/path" (no match).
      rest = rest.replace(/^[^/]+/, '');
      try {
        p = decodeURIComponent(rest);
      } catch {
        p = rest;
      }
    } else {
      return {
        status: 'unsupported_scheme',
        segments: [],
        strippedVolume: null,
        normalizedRelative: null,
      };
    }
  }

  // 3. Windows backslash → forward slash.
  p = p.replace(/\\/g, '/');

  // 4. Strip Windows drive letter (e.g. "E:/", "c:/", "D:\").
  //    After step 3 the separator is always "/".
  p = p.replace(/^[A-Za-z]:\//, '');

  // 5. Strip /Volumes/{name}/ macOS mount-point prefix.
  let strippedVolume: string | null = null;
  const volMatch = p.match(/^\/Volumes\/([^/]+)(\/|$)/);
  if (volMatch) {
    strippedVolume = volMatch[1];
    // Remove "/Volumes/{name}" from the front; the remainder starts with "/"
    // or is empty (if the path was exactly "/Volumes/{name}").
    p = p.slice('/Volumes/'.length + strippedVolume.length);
  }

  // 6. Collapse leading slashes.
  p = p.replace(/^\/+/, '');

  // 7. Collapse consecutive interior separators.
  p = p.replace(/\/+/g, '/');

  // 8. Split and filter empty strings (handles a trailing slash).
  const segments = p.split('/').filter((s) => s.length > 0);

  // 9. Traversal check — must happen AFTER splitting so we catch "." and "..".
  if (segmentsHaveTraversal(segments)) {
    return {
      status: 'unsafe',
      segments: [],
      strippedVolume,
      normalizedRelative: null,
    };
  }

  // 10. Nothing left after stripping prefixes.
  if (segments.length === 0) {
    return {
      status: 'no_filename',
      segments: [],
      strippedVolume,
      normalizedRelative: null,
    };
  }

  const normalizedRelative = segments.join('/');

  // 11. Volume name mismatch (informational — segments are still returned).
  const { expectedVolume } = options;
  if (expectedVolume && strippedVolume && strippedVolume !== expectedVolume) {
    return {
      status: 'volume_prefix_mismatch',
      segments,
      strippedVolume,
      normalizedRelative,
    };
  }

  return {
    status: 'ok',
    segments,
    strippedVolume,
    normalizedRelative,
  };
}
