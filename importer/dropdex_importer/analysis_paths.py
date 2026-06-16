"""
ANLZ path normalization, security validation, and Storage key construction.

All functions are pure (no I/O, no pyrekordbox imports).

Canonical path format
---------------------
A canonical ANLZ path is a relative, forward-slash-separated string that
begins with the PIONEER directory segment:

    PIONEER/USBANLZ/P001/ANLZ0000.DAT

This form is suitable for:
- Storage object keys (deterministic, platform-independent)
- Case-insensitive sibling matching
- Cross-platform round-trips

Upload-root detection
---------------------
Rekordbox stores ANLZ files inside a PIONEER folder at the root of the USB
device.  When a user uploads ANLZ files, they may select:

  - USB root     → relative paths like PIONEER/USBANLZ/P001/ANLZ0000.DAT
  - PIONEER dir  → relative paths like USBANLZ/P001/ANLZ0000.DAT
  - USBANLZ dir  → relative paths like P001/ANLZ0000.DAT

Call `detect_upload_root(sample_path)` on the first path from the upload
batch to determine which level was selected, then pass the result to
`normalize_upload_path` for every path in the batch.
"""

from __future__ import annotations

import re
import struct as _struct
from os.path import normpath
from pathlib import PurePosixPath
from typing import Optional, Tuple

# ── Constants ─────────────────────────────────────────────────────────────────

_DRIVE_LETTER_RE = re.compile(r"^/?[A-Za-z]:")
_SLASH_RE = re.compile(r"/+")

_PIONEER_LOWER = "pioneer"
_USBANLZ_LOWER = "usbanlz"

# Upload-root sentinel values returned by detect_upload_root
ROOT_USB = "usb_root"       # PIONEER/USBANLZ/... present
ROOT_PIONEER = "pioneer"    # USBANLZ/... present (no PIONEER prefix)
ROOT_USBANLZ = "usbanlz"   # neither anchor found
ROOT_UNKNOWN = "unknown"    # empty or could not be determined


# ── Security validation ───────────────────────────────────────────────────────


def is_safe_path(raw_path: str) -> bool:
    """
    Return True when raw_path passes all security checks.

    Rejects:
    - Null bytes
    - ``..`` traversal segments (any form)
    - Absolute server-side Unix/Windows paths that are not plausibly ANLZ
      (a path beginning with ``/`` after drive-letter stripping and slash
      normalization will be caught by the canonical-form requirement)

    This check runs before normalization.  It operates on the raw string so
    that URL-encoded traversal (``%2e%2e``) would still surface if the caller
    decoded the string first.
    """
    if not raw_path:
        return False
    if "\x00" in raw_path:
        return False
    # Normalize separators temporarily just to check for traversal
    temp = raw_path.replace("\\", "/")
    for part in temp.split("/"):
        if part == "..":
            return False
    # Reject percent-encoded traversal
    if "%2e%2e" in raw_path.lower() or "%2f" in raw_path.lower():
        return False
    return True


def is_safe_under(base_dir: str, relative_path: str) -> bool:
    """
    Return True when joining base_dir with relative_path stays inside base_dir.

    Prevents escape even if normalization missed an edge case.
    """
    from pathlib import Path

    resolved = (Path(base_dir) / relative_path).resolve()
    base = Path(base_dir).resolve()
    try:
        resolved.relative_to(base)
        return True
    except ValueError:
        return False


# ── Core normalization ────────────────────────────────────────────────────────


def _strip_to_parts(raw_path: str) -> Optional[list[str]]:
    """
    Common first pass: convert separators, strip drive letter, split into parts.
    Returns None on security violation.
    """
    if not is_safe_path(raw_path):
        return None
    path = raw_path.replace("\\", "/")
    path = _DRIVE_LETTER_RE.sub("", path)
    path = _SLASH_RE.sub("/", path).strip("/")
    if not path:
        return None
    parts = [p for p in path.split("/") if p]
    return parts if parts else None


def normalize_anlz_path(raw_path: str) -> Optional[str]:
    """
    Normalize an ANLZ path from the Rekordbox exportLibrary.db to a canonical
    relative form beginning at the PIONEER segment.

    This is the primary normalizer for **database-sourced** paths (the
    ``analysisDataFilePath`` column).  These paths always contain the PIONEER
    segment; the function strips everything before it.

    Steps applied:
    1. Security checks (null bytes, traversal).
    2. Backslash → forward slash.
    3. Remove Windows drive-letter prefix (``C:`` / ``/D:``).
    4. Collapse duplicate separators.
    5. Strip leading separator to produce a relative path.
    6. Locate ``PIONEER`` (case-insensitive) and return from that segment.
    7. If ``PIONEER`` is absent but ``USBANLZ`` is present, prepend
       ``PIONEER/``.
    8. If neither anchor is present, return the path as-is (still relative).

    Returns ``None`` for empty input or security violations.

    Callers should compare canonical paths case-insensitively when matching
    DB paths against upload paths.
    """
    parts = _strip_to_parts(raw_path)
    if parts is None:
        return None
    lower = [p.lower() for p in parts]
    if _PIONEER_LOWER in lower:
        idx = lower.index(_PIONEER_LOWER)
        return "/".join(parts[idx:])
    if _USBANLZ_LOWER in lower:
        idx = lower.index(_USBANLZ_LOWER)
        return "PIONEER/" + "/".join(parts[idx:])
    # Neither anchor — still a valid relative path
    return "/".join(parts)


# ── Upload-path normalization ─────────────────────────────────────────────────


def detect_upload_root(sample_path: str) -> str:
    """
    Inspect the first path from a user's upload batch to determine which
    folder level the user selected as their upload root.

    Returns one of the ``ROOT_*`` sentinel constants.

    Call this once per batch, then pass the result to ``normalize_upload_path``
    for every path in the batch.
    """
    parts = _strip_to_parts(sample_path)
    if not parts:
        return ROOT_UNKNOWN
    lower = [p.lower() for p in parts]
    if _PIONEER_LOWER in lower:
        return ROOT_USB
    if _USBANLZ_LOWER in lower:
        return ROOT_PIONEER
    return ROOT_USBANLZ


def normalize_upload_path(raw_path: str, upload_root: str) -> Optional[str]:
    """
    Normalize an upload-relative path to the canonical PIONEER-rooted form.

    Parameters
    ----------
    raw_path:
        Relative path as seen in the browser FileList (may contain forward or
        back slashes from different OS / browser combinations).
    upload_root:
        One of ``ROOT_USB``, ``ROOT_PIONEER``, ``ROOT_USBANLZ``, or ``ROOT_UNKNOWN``.
        Typically obtained from ``detect_upload_root(first_path)`` on the batch.

    Returns
    -------
    Canonical relative path starting with the PIONEER segment, or ``None``
    on security violation.
    """
    parts = _strip_to_parts(raw_path)
    if parts is None:
        return None

    lower = [p.lower() for p in parts]

    # If PIONEER is already present (regardless of hint), anchor to it
    if _PIONEER_LOWER in lower:
        idx = lower.index(_PIONEER_LOWER)
        return "/".join(parts[idx:])

    if upload_root == ROOT_USB:
        # Uploaded from USB root but PIONEER is missing — treat as-is
        return "/".join(parts)
    elif upload_root == ROOT_PIONEER:
        # User selected the PIONEER folder; paths are USBANLZ/...
        if _USBANLZ_LOWER in lower:
            idx = lower.index(_USBANLZ_LOWER)
            return "PIONEER/" + "/".join(parts[idx:])
        return "PIONEER/" + "/".join(parts)
    elif upload_root == ROOT_USBANLZ:
        # User selected the USBANLZ folder; paths are P001/...
        return "PIONEER/USBANLZ/" + "/".join(parts)
    else:
        # ROOT_UNKNOWN — best-effort: check for anchors, else return as-is
        if _USBANLZ_LOWER in lower:
            idx = lower.index(_USBANLZ_LOWER)
            return "PIONEER/" + "/".join(parts[idx:])
        return "/".join(parts)


# ── Sibling path derivation ───────────────────────────────────────────────────


def derive_anlz_siblings(canonical_path: str) -> Tuple[str, str, str]:
    """
    Return ``(dat_path, ext_path, two_ex_path)`` from any canonical ANLZ path.

    The returned paths share the same directory and stem but have different
    extensions.  Neither EXT nor 2EX is considered required.

    Examples
    --------
    >>> derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000.DAT")
    ('PIONEER/USBANLZ/P001/ANLZ0000.DAT',
     'PIONEER/USBANLZ/P001/ANLZ0000.EXT',
     'PIONEER/USBANLZ/P001/ANLZ0000.2EX')
    """
    # Work with forward slashes
    normalized = canonical_path.replace("\\", "/")
    upper = normalized.upper()
    if upper.endswith(".DAT") or upper.endswith(".EXT") or upper.endswith(".2EX"):
        stem = normalized[:-4]
    else:
        stem = normalized  # No recognized extension — treat whole string as stem
    return stem + ".DAT", stem + ".EXT", stem + ".2EX"


# ── Storage key construction ──────────────────────────────────────────────────


def build_storage_path(user_id: str, import_id: str, canonical_path: str) -> str:
    """
    Build a deterministic, private Storage object path for an ANLZ asset.

    Format::

        {user_id}/{import_id}/anlz/{canonical_path}

    where ``canonical_path`` is the PIONEER-rooted relative path, e.g.::

        {user_id}/{import_id}/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT

    The ``user_id`` prefix is the first path segment so that the Storage RLS
    policy ``(storage.foldername(name))[1] = auth.uid()::text`` can grant
    authenticated users read access to their own objects only.

    The ``import_id`` segment ensures objects from different imports never
    collide even if the USB content is identical.  Objects live inside the
    private ``rekordbox-analysis-assets`` bucket and are never made public.

    Parameters
    ----------
    user_id:
        The Supabase Auth UID of the owning user.  Must be the first segment.
    import_id:
        The Supabase UUID of the ``rekordbox_imports`` row.
    canonical_path:
        Normalized relative path from ``normalize_anlz_path`` or
        ``normalize_upload_path``.  Must not be empty or start with ``/``.
    """
    clean = canonical_path.lstrip("/")
    if not clean:
        raise ValueError("canonical_path must not be empty")
    return f"{user_id}/{import_id}/anlz/{clean}"
