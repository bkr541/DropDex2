"""
Read-only parser for rekordbox DeviceLibraryPlus (exportLibrary.db) files.

The database is opened via pyrekordbox's DeviceLibraryPlus class (which uses
SQLAlchemy + SQLCipher under the hood). No write methods are called; the session
is closed via the context manager when parsing completes.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from .models import (
    NormalizedPlacement,
    NormalizedPlaylist,
    NormalizedTrack,
    ParsedLibrary,
)
from .music_keys import parse_key_identity

logger = logging.getLogger(__name__)

# Maps exportLibrary.db fileType integer → human-readable string
_FILE_TYPE_NAMES: dict[int, str] = {
    1: "MP3",
    4: "M4A",
    5: "FLAC",
    11: "WAV",
    12: "AIFF",
}

# Playlist.attribute value that marks a folder (not a playable playlist)
_FOLDER_ATTRIBUTE = 1


def _str_or_none(value: object) -> Optional[str]:
    """Return a stripped, non-empty string or None."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def parse_library(db_path: str) -> ParsedLibrary:
    """
    Open an exportLibrary.db file and return a fully-populated ParsedLibrary.

    The database is treated as strictly read-only: no commit(), add(), delete(),
    or flush() calls are made at any point.

    Raises
    ------
    FileNotFoundError
        If db_path does not exist on disk.
    ImportError
        If pyrekordbox or sqlcipher3 is not installed.
    RuntimeError
        If the database cannot be opened or parsed.
    """
    try:
        from pyrekordbox.devicelib_plus import DeviceLibraryPlus
    except ImportError as exc:
        raise ImportError(
            "pyrekordbox DeviceLibraryPlus is not available.\n"
            "Install the pinned development build:\n"
            "  pip install -r importer/requirements.txt"
        ) from exc

    path = Path(db_path)
    if not path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    library = ParsedLibrary(source_filename=path.name)

    try:
        _open_and_extract(DeviceLibraryPlus, path, library)
    except ImportError as exc:
        # sqlcipher3 missing — give an actionable error
        if "sqlcipher3" in str(exc).lower() or "sqlcipher" in str(exc).lower():
            raise ImportError(
                "Cannot open the encrypted exportLibrary.db: sqlcipher3 is not installed.\n"
                "Install it with:\n"
                "  pip install sqlcipher3-binary\n"
                "If that fails on your platform, see importer/README.md for "
                "source-build instructions."
            ) from exc
        raise
    except Exception as exc:
        raise RuntimeError(f"Failed to parse {db_path}: {exc}") from exc

    return library


def _open_and_extract(DeviceLibraryPlus, path: Path, library: ParsedLibrary) -> None:
    with DeviceLibraryPlus(path=str(path)) as db:
        _extract_metadata(db, library)
        _extract_tracks(db, library)
        _extract_playlists(db, library)
        _extract_placements(db, library)


# ── Extraction helpers ────────────────────────────────────────────────────────


def _extract_metadata(db: object, library: ParsedLibrary) -> None:
    props = db.get_property().all()  # type: ignore[attr-defined]
    if props:
        prop = props[0]
        library.device_name = _str_or_none(prop.deviceName)
        library.database_version = (
            str(prop.dbVersion) if prop.dbVersion is not None else None
        )
        if prop.createdDate is not None:
            try:
                library.rekordbox_created_date = prop.createdDate.strftime("%Y-%m-%d")
            except Exception:
                library.rekordbox_created_date = None
    logger.debug(
        "Metadata: device=%s db_version=%s created=%s",
        library.device_name,
        library.database_version,
        library.rekordbox_created_date,
    )


def _extract_tracks(db: object, library: ParsedLibrary) -> None:
    contents = db.get_content().all()  # type: ignore[attr-defined]
    logger.debug("Raw content rows: %d", len(contents))

    for c in contents:
        title = _str_or_none(c.title) or "(untitled)"

        # Relationships resolve via association_proxy; return None when FK is null.
        artist = _str_or_none(c.artist_name)
        remixer = _str_or_none(c.remixer_name)
        album = _str_or_none(c.album_name)
        genre = _str_or_none(c.genre_name)
        label = _str_or_none(c.label_name)

        # Key is a separate table; c.key is the ORM relationship object.
        musical_key: Optional[str] = _str_or_none(c.key.name) if c.key else None
        key_identity = parse_key_identity(musical_key)

        # BPM is stored as integer * 100 (e.g. 12350 → 123.50).
        # Treat 0 the same as None — means BPM was never analysed.
        bpm: Optional[float] = None
        if c.bpmx100:
            bpm = round(c.bpmx100 / 100.0, 2)

        # Duration is stored in milliseconds.
        duration_seconds: Optional[int] = None
        if c.length:
            duration_seconds = int(c.length // 1000)

        comments = _str_or_none(c.djComment)
        file_path = _str_or_none(c.path)
        file_format = _FILE_TYPE_NAMES.get(c.fileType) if c.fileType is not None else None

        date_added: Optional[str] = None
        if c.dateAdded is not None:
            try:
                date_added = c.dateAdded.strftime("%Y-%m-%d")
            except Exception:
                date_added = None

        library.tracks.append(
            NormalizedTrack(
                rekordbox_content_id=str(c.content_id),
                title=title,
                artist=artist,
                album=album,
                remixer=remixer,
                genre=genre,
                label=label,
                musical_key=musical_key,
                bpm=bpm,
                duration_seconds=duration_seconds,
                rating=c.rating,  # 0-5 or None; store as-is
                comments=comments,
                file_path=file_path,
                file_format=file_format,
                date_added=date_added,
                camelot_key=key_identity.camelot_key,
                normalized_key_name=key_identity.normalized_key_name,
                key_tonic=key_identity.key_tonic,
                key_mode=key_identity.key_mode,
            )
        )

    logger.info("Extracted %d tracks", len(library.tracks))


def _extract_playlists(db: object, library: ParsedLibrary) -> None:
    playlists = db.get_playlist().all()  # type: ignore[attr-defined]
    logger.debug("Raw playlist rows: %d", len(playlists))

    for p in playlists:
        is_folder = p.attribute == _FOLDER_ATTRIBUTE

        # playlist_id_parent == None or 0 means top-level (no parent)
        parent_id: Optional[str] = None
        if p.playlist_id_parent and p.playlist_id_parent != 0:
            parent_id = str(p.playlist_id_parent)

        library.playlists.append(
            NormalizedPlaylist(
                rekordbox_playlist_id=str(p.playlist_id),
                name=p.name or "(unnamed)",
                parent_rekordbox_playlist_id=parent_id,
                sort_order=p.sequenceNo if p.sequenceNo is not None else None,
                is_folder=is_folder,
            )
        )

    folder_count = sum(1 for pl in library.playlists if pl.is_folder)
    logger.info(
        "Extracted %d playlists (%d folders, %d playable)",
        len(library.playlists),
        folder_count,
        len(library.playlists) - folder_count,
    )


def _extract_placements(db: object, library: ParsedLibrary) -> None:
    placements = db.get_playlist_content().all()  # type: ignore[attr-defined]
    logger.debug("Raw playlist_content rows: %d", len(placements))

    for pc in placements:
        library.placements.append(
            NormalizedPlacement(
                rekordbox_playlist_id=str(pc.playlist_id),
                rekordbox_content_id=str(pc.content_id),
                position=pc.sequenceNo,
            )
        )

    logger.info("Extracted %d playlist-track placements", len(library.placements))
