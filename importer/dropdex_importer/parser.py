"""
Read-only parser for rekordbox DeviceLibraryPlus (exportLibrary.db) files.

The database is opened via pyrekordbox's DeviceLibraryPlus class (which uses
SQLAlchemy + SQLCipher under the hood). No write methods are called; the session
is closed via the context manager when parsing completes.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Dict, Optional

from .models import (
    AnalysisFileSpec,
    NormalizedAnalysisManifestEntry,
    NormalizedCue,
    NormalizedPlacement,
    NormalizedPlaylist,
    NormalizedRecommendationEdge,
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

# Cue kind values as documented in pyrekordbox devicelib_plus models
_CUE_KIND_LOOP = 4


def _str_or_none(value: object) -> Optional[str]:
    """Return a stripped, non-empty string or None."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _int_or_none(value: object) -> Optional[int]:
    """Convert to int or None; treats empty strings and unconvertible values as None.

    pyrekordbox sometimes returns "" from SQLite integer columns when the cell
    has no value.  Passing "" to a PostgreSQL bigint column causes error 22P02.
    """
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _bool_or_none(value: object) -> Optional[bool]:
    """Normalize Rekordbox integer flags without inventing False for null."""
    parsed = _int_or_none(value)
    return None if parsed is None else bool(parsed)


def _date_or_none(value: object) -> Optional[str]:
    if value is None:
        return None
    try:
        return value.isoformat()  # type: ignore[union-attr]
    except Exception:
        return _str_or_none(value)


def _json_scalar(value: object) -> object:
    """Convert ORM scalar values to JSON-safe primitives for diagnostics."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        try:
            return isoformat()
        except Exception:
            pass
    return str(value)


def _id_str_or_none(value: object) -> Optional[str]:
    """Convert a numeric Rekordbox ID to its canonical string form, or None.

    Rekordbox stores IDs as integers in SQLite.  pyrekordbox may return them
    as ints, floats, or empty strings depending on the column type affinity.
    We normalise to a decimal string (e.g. "12345") or None.
    """
    if value is None:
        return None
    try:
        return str(int(value))
    except (ValueError, TypeError):
        return None


# ── Analysis path normalization ───────────────────────────────────────────────

_DRIVE_LETTER_RE = re.compile(r'^/?[A-Za-z]:')

_WINDOWS_AUDIO_PATH_RE = re.compile(r"^/?([A-Za-z]:)(?:/|$)")
_VOLUMES_AUDIO_PATH_RE = re.compile(r"^/Volumes/([^/]+)(?:/(.*))?$", re.IGNORECASE)
_MEDIA_AUDIO_PATH_RE = re.compile(r"^/(?:run/)?media/[^/]+/([^/]+)(?:/(.*))?$", re.IGNORECASE)


def normalize_audio_path(raw_path: str) -> tuple[Optional[str], Optional[str]]:
    """Return a portable USB-relative path and any explicit source volume hint."""
    if not raw_path or not raw_path.strip():
        return None, None

    normalized = raw_path.strip().replace("\\", "/")
    volume: Optional[str] = None

    windows = _WINDOWS_AUDIO_PATH_RE.match(normalized)
    if windows:
        volume = windows.group(1)
        normalized = "/" + normalized[windows.end() :].lstrip("/")
    else:
        volumes = _VOLUMES_AUDIO_PATH_RE.match(normalized)
        media = _MEDIA_AUDIO_PATH_RE.match(normalized)
        match = volumes or media
        if match:
            volume = match.group(1)
            normalized = "/" + (match.group(2) or "")

    normalized = re.sub(r"/+", "/", normalized)
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    parts = [part for part in normalized.split("/") if part]
    if ".." in parts:
        return None, volume
    return "/" + "/".join(parts), volume


def normalize_analysis_path(raw_path: str) -> Optional[str]:
    """Normalize an ANLZ path for portable, case-insensitive file matching.

    Steps applied in order:
    1. Convert backslashes to forward slashes.
    2. Remove optional Windows drive-letter prefix (e.g. ``C:`` or ``/D:``).
    3. Collapse duplicate forward slashes.
    4. Ensure the result is rooted (leading ``/``).
    5. Reject any path that contains ``..`` traversal segments.

    Returns None for empty input or paths that contain traversal segments.
    Callers should compare paths case-insensitively.
    """
    if not raw_path or not raw_path.strip():
        return None

    normalized = raw_path.replace("\\", "/")
    normalized = _DRIVE_LETTER_RE.sub("", normalized)
    normalized = re.sub(r"/+", "/", normalized)

    if not normalized.startswith("/"):
        normalized = "/" + normalized

    # Reject traversal
    parts = [p for p in normalized.split("/") if p]
    if ".." in parts:
        return None

    return "/" + "/".join(parts)


def _derive_anlz_siblings(original_path: str) -> tuple[str, str, str]:
    """Return (dat_path, ext_path, two_ex_path) from an analysis data file path.

    The path stored by Rekordbox points to the DAT file.  EXT and 2EX siblings
    share the same directory and stem but have different extensions.
    """
    normalized = original_path.replace("\\", "/")
    upper = normalized.upper()
    if upper.endswith(".DAT"):
        stem = normalized[:-4]
    elif upper.endswith(".EXT") or upper.endswith(".2EX"):
        stem = normalized[:-4]
    else:
        # No recognized extension — treat the whole string as the stem
        stem = normalized
    return stem + ".DAT", stem + ".EXT", stem + ".2EX"


# ── Public entry point ────────────────────────────────────────────────────────


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
        # 1. Metadata (device name, DB version, creation date)
        _extract_metadata(db, library)

        # 2. Tracks + analysis manifest (must precede cues and edges)
        _extract_tracks(db, library)
        _extract_analysis_manifest(library)

        # 3. Playlists
        _extract_playlists(db, library)

        # 4. Playlist placements
        _extract_placements(db, library)

        # 5. Color lookup table (needed for step 6)
        color_map = _extract_colors(db, library)

        # 6. Cues (optional; failure produces a warning)
        _extract_cues(db, library, color_map)

        # 7. recommendedLike edges (optional; failure produces a warning)
        _extract_recommendations(db, library)


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
        source_title = _str_or_none(c.title)
        title = source_title or "(untitled)"

        # Relationships resolve via association_proxy; return None when FK is null.
        artist = _str_or_none(c.artist_name)
        remixer = _str_or_none(c.remixer_name)
        original_artist = _str_or_none(getattr(c, "original_artist_name", None))
        composer = _str_or_none(getattr(c, "composer_name", None))
        lyricist = _str_or_none(getattr(c, "lyricist_name", None))
        album = _str_or_none(c.album_name)
        genre = _str_or_none(c.genre_name)
        label = _str_or_none(c.label_name)
        color = getattr(c, "color", None)
        color_name = _str_or_none(getattr(color, "name", None))
        artwork_path = _str_or_none(getattr(c, "image_path", None))

        # Key is a separate table; c.key is the ORM relationship object.
        musical_key: Optional[str] = _str_or_none(c.key.name) if c.key else None
        key_identity = parse_key_identity(musical_key)

        # BPM is stored as integer * 100 (e.g. 12350 → 123.50).
        # Treat 0 the same as None — means BPM was never analysed.
        bpm: Optional[float] = None
        if c.bpmx100:
            bpm = round(c.bpmx100 / 100.0, 2)

        # Duration is stored in milliseconds.
        duration_ms = _int_or_none(c.length)
        if duration_ms is not None and duration_ms < 0:
            library.parse_warnings.append(
                f"Track {c.content_id} has a negative duration; storing no duration."
            )
            duration_ms = None
        duration_seconds = duration_ms // 1000 if duration_ms is not None else None

        rating = _int_or_none(getattr(c, "rating", None))
        if rating is not None and not 0 <= rating <= 5:
            library.parse_warnings.append(
                f"Track {c.content_id} has rating {rating!r} outside 0-5; storing no rating."
            )
            rating = None

        comments = _str_or_none(c.djComment)
        file_path = _str_or_none(c.path)
        file_path_normalized, file_path_volume = normalize_audio_path(file_path or "")
        file_type_code = _int_or_none(c.fileType)
        file_format = _FILE_TYPE_NAMES.get(file_type_code) if file_type_code is not None else None
        file_name = _str_or_none(getattr(c, "fileName", None)) or (Path(file_path_normalized).name if file_path_normalized else None)
        file_extension = Path(file_name).suffix.lstrip(".").upper() if file_name and Path(file_name).suffix else None

        date_added: Optional[str] = None
        if c.dateAdded is not None:
            try:
                date_added = c.dateAdded.strftime("%Y-%m-%d")
            except Exception:
                date_added = None
        release_date = _date_or_none(getattr(c, "releaseDate", None))

        try:
            source_metadata = {
                key: _json_scalar(value)
                for key, value in c.to_dict().items()
                if value is not None
            }
        except Exception:
            source_metadata = {}

        # Analysis pipeline fields
        master_db_id = _id_str_or_none(c.masterDbId)
        master_content_id = _id_str_or_none(c.masterContentId)
        analysis_data_file_path = _str_or_none(c.analysisDataFilePath)
        analysed_bits = _int_or_none(c.analysedBits)
        cue_update_count = _int_or_none(c.cueUpdateCount)
        analysis_data_update_count = _int_or_none(c.analysisDataUpdateCount)
        information_update_count = _int_or_none(c.informationUpdateCount)

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
                rating=rating,
                comments=comments,
                file_path=file_path,
                file_format=file_format,
                date_added=date_added,
                source_title=source_title,
                subtitle=_str_or_none(getattr(c, "subtitle", None)),
                original_artist=original_artist,
                composer=composer,
                lyricist=lyricist,
                duration_ms=duration_ms,
                track_number=_int_or_none(getattr(c, "trackNo", None)),
                disc_number=_int_or_none(getattr(c, "discNo", None)),
                release_year=_int_or_none(getattr(c, "releaseYear", None)),
                release_date=release_date,
                color_name=color_name,
                artwork_path=artwork_path,
                file_name=file_name,
                file_size_bytes=_int_or_none(getattr(c, "fileSize", None)),
                file_type_code=file_type_code,
                file_extension=file_extension,
                bitrate_kbps=_int_or_none(getattr(c, "bitrate", None)),
                bit_depth=_int_or_none(getattr(c, "bitDepth", None)),
                sample_rate_hz=_int_or_none(getattr(c, "samplingRate", None)),
                isrc=_str_or_none(getattr(c, "isrc", None)),
                hot_cue_auto_load=_bool_or_none(getattr(c, "isHotCueAutoLoadOn", None)),
                file_path_normalized=file_path_normalized,
                file_path_volume=file_path_volume,
                file_path_casefold=file_path_normalized.casefold() if file_path_normalized else None,
                source_metadata=source_metadata,
                camelot_key=key_identity.camelot_key,
                normalized_key_name=key_identity.normalized_key_name,
                key_tonic=key_identity.key_tonic,
                key_mode=key_identity.key_mode,
                master_db_id=master_db_id,
                master_content_id=master_content_id,
                analysis_data_file_path=analysis_data_file_path,
                analysed_bits=analysed_bits,
                cue_update_count=cue_update_count,
                analysis_data_update_count=analysis_data_update_count,
                information_update_count=information_update_count,
            )
        )

    logger.info("Extracted %d tracks", len(library.tracks))


def _extract_analysis_manifest(library: ParsedLibrary) -> None:
    """Build one manifest entry per track that has an analysisDataFilePath."""
    for track in library.tracks:
        raw_path = track.analysis_data_file_path
        if not raw_path:
            continue

        normalized = normalize_analysis_path(raw_path)
        if normalized is None:
            logger.warning(
                "Track %s: analysis path %r rejected (traversal or invalid) — skipping manifest entry",
                track.rekordbox_content_id,
                raw_path,
            )
            library.parse_warnings.append(
                f"Track {track.rekordbox_content_id}: "
                f"analysis path {raw_path!r} rejected (traversal or invalid)"
            )
            continue

        dat_orig, ext_orig, two_ex_orig = _derive_anlz_siblings(raw_path)
        dat_norm, ext_norm, two_ex_norm = _derive_anlz_siblings(normalized)

        entry = NormalizedAnalysisManifestEntry(
            rekordbox_content_id=track.rekordbox_content_id,
            original_analysis_path=raw_path,
            normalized_analysis_path=normalized,
            files=[
                AnalysisFileSpec(
                    asset_type="DAT",
                    original_path=dat_orig,
                    normalized_path=dat_norm,
                    is_required=True,
                ),
                AnalysisFileSpec(
                    asset_type="EXT",
                    original_path=ext_orig,
                    normalized_path=ext_norm,
                    is_required=False,
                ),
                AnalysisFileSpec(
                    asset_type="2EX",
                    original_path=two_ex_orig,
                    normalized_path=two_ex_norm,
                    is_required=False,
                ),
            ],
        )
        library.analysis_manifest.append(entry)

    logger.info(
        "Built analysis manifest: %d/%d tracks have analysis paths",
        len(library.analysis_manifest),
        len(library.tracks),
    )


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


def _extract_colors(db: object, library: ParsedLibrary) -> Dict[int, str]:
    """Build a {color_id: name} map from the Color table.

    The Color table stores track label colors.  Cue.colorTableIndex may reference
    these entries; the lookup is best-effort — if the table is absent or corrupt,
    an empty map is returned and a warning is recorded.

    Note: the Color table has no RGB/hex column, so color_hex is always None.
    """
    color_map: Dict[int, str] = {}
    try:
        colors = db.get_color().all()  # type: ignore[attr-defined]
        for c in colors:
            if c.color_id is not None and c.name:
                color_map[int(c.color_id)] = str(c.name)
        logger.debug("Loaded %d color table entries", len(color_map))
    except Exception as exc:
        msg = f"Could not load Color table: {exc}"
        logger.warning(msg)
        library.parse_warnings.append(msg)
    return color_map


def _extract_cues(
    db: object, library: ParsedLibrary, color_map: Dict[int, str]
) -> None:
    """Extract all cue rows from the Cue table.

    A failure on this optional table appends a warning and returns without
    raising so that the overall library import remains usable.
    """
    try:
        cue_rows = db.get_cue().all()  # type: ignore[attr-defined]
    except Exception as exc:
        msg = f"Could not load Cue table: {exc}"
        logger.warning(msg)
        library.parse_warnings.append(msg)
        return

    logger.debug("Raw cue rows: %d", len(cue_rows))

    for c in cue_rows:
        cti = c.colorTableIndex  # may be None, 0, or a positive integer
        color_name: Optional[str] = None
        if cti is not None and cti > 0:
            color_name = color_map.get(int(cti))

        # Provisional family: colorTableIndex > 0 → hot cue, else memory cue.
        # This will be confirmed against ANLZ data in a later pipeline stage.
        cue_family = "hot" if (cti is not None and cti > 0) else "memory"

        # Provisional point_type from the raw kind field.
        point_type = "loop" if c.kind == _CUE_KIND_LOOP else "cue"

        # Stable dedupe key — prefixed to distinguish from future ANLZ-sourced keys.
        dedupe_key = f"db:{c.cue_id}"

        is_active_loop: Optional[bool] = None
        if c.isActiveLoop is not None:
            is_active_loop = bool(c.isActiveLoop)

        library.cues.append(
            NormalizedCue(
                rekordbox_cue_id=str(c.cue_id),
                rekordbox_content_id=str(c.content_id),
                kind=c.kind if c.kind is not None else 0,
                color_table_index=int(cti) if cti is not None else None,
                cue_comment=_str_or_none(c.cueComment),
                is_active_loop=is_active_loop,
                beat_loop_numerator=c.beatLoopNumerator,
                beat_loop_denominator=c.beatLoopDenominator,
                in_usec=c.inUsec,
                out_usec=c.outUsec,
                in_150_frames_per_second=c.in150FramePerSec,
                out_150_frames_per_second=c.out150FramePerSec,
                in_mpeg_frame_number=c.inMpegFrameNumber,
                out_mpeg_frame_number=c.outMpegFrameNumber,
                in_mpeg_abs=c.inMpegAbs,
                out_mpeg_abs=c.outMpegAbs,
                in_decoding_start_frame_position=c.inDecodingStartFramePosition,
                out_decoding_start_frame_position=c.outDecodingStartFramePosition,
                in_file_offset_in_block=c.inFileOffsetInBlock,
                out_file_offset_in_block=c.outFileOffsetInBlock,
                in_number_of_sample_in_block=c.inNumberOfSampleInBlock,
                out_number_of_sample_in_block=c.outNumberOfSampleInBlock,
                color_name=color_name,
                cue_family=cue_family,
                point_type=point_type,
                hot_cue_slot=None,  # not determinable from DB; requires ANLZ
                dedupe_key=dedupe_key,
            )
        )

    logger.info("Extracted %d cues", len(library.cues))


def _extract_recommendations(db: object, library: ParsedLibrary) -> None:
    """Extract recommendedLike rows, preserving content_id_1 → content_id_2 direction.

    A failure on this optional table appends a warning and returns without
    raising so that the overall library import remains usable.
    """
    try:
        rows = db.get_recommended_like().all()  # type: ignore[attr-defined]
    except Exception as exc:
        msg = f"Could not load RecommendedLike table: {exc}"
        logger.warning(msg)
        library.parse_warnings.append(msg)
        return

    logger.debug("Raw recommendedLike rows: %d", len(rows))

    for r in rows:
        source_created_at: Optional[str] = None
        if r.createdDate is not None:
            try:
                source_created_at = r.createdDate.strftime("%Y-%m-%dT%H:%M:%S")
            except Exception:
                source_created_at = None

        rating = _int_or_none(getattr(r, "rating", None))
        if rating is not None and not 0 <= rating <= 5:
            library.parse_warnings.append(
                "RecommendedLike edge "
                f"{r.content_id_1}->{r.content_id_2} has rating {rating!r} outside 0-5; "
                "storing no rating."
            )
            rating = None

        library.recommendation_edges.append(
            NormalizedRecommendationEdge(
                source_rekordbox_content_id=str(r.content_id_1),
                target_rekordbox_content_id=str(r.content_id_2),
                rating=rating,
                source_created_at=source_created_at,
                direction_preserved=True,
                source_payload={
                    "content_id_1": r.content_id_1,
                    "content_id_2": r.content_id_2,
                    "rating": rating,
                },
            )
        )

    logger.info("Extracted %d recommendation edges", len(library.recommendation_edges))
