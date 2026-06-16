"""Extract Related Tracks data from a Rekordbox master.db via pyrekordbox."""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import BridgePayload, RelatedTrackList, RelatedTrackMember, SourceInfo

logger = logging.getLogger(__name__)

try:
    from pyrekordbox import Rekordbox6Database  # type: ignore
except ImportError:
    Rekordbox6Database = None  # type: ignore[assignment,misc]


def _now_iso() -> str:
    """Return current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def extract_related_tracks(db_path: Path, verbose: bool = False) -> BridgePayload:
    """
    Open *db_path* READ-ONLY through pyrekordbox.
    Extract Related Tracks lists and return a BridgePayload.

    Never modifies db_path.
    Never uploads db_path or its contents.
    """
    if Rekordbox6Database is None:
        raise ImportError(
            "pyrekordbox is not installed. Run: pip install pyrekordbox"
        )

    if verbose:
        logger.setLevel(logging.DEBUG)
        if not logger.handlers:
            logger.addHandler(logging.StreamHandler(sys.stderr))

    logger.debug("Opening database: %s", db_path)

    try:
        db = Rekordbox6Database(str(db_path))
    except Exception as exc:
        raise RuntimeError(
            f"Failed to open Rekordbox database at {db_path}: {exc}"
        ) from exc

    source = _extract_source_info(db, verbose=verbose)
    lists = _extract_lists(db, verbose=verbose)

    # Criteria-based lists stay as lists with criteria_raw preserved —
    # we do NOT expand them into all-to-all edges.

    return BridgePayload(
        schema_version=1,
        generated_at=_now_iso(),
        source=source,
        lists=lists,
    )


def _safe_get(obj: Any, *attrs: str, default: Any = None) -> Any:
    """Walk a chain of attribute accesses safely, returning default on any failure."""
    current = obj
    for attr in attrs:
        try:
            current = getattr(current, attr)
        except AttributeError:
            return default
    return current


def _extract_source_info(db: Any, verbose: bool = False) -> SourceInfo:
    """Extract database / device identity fields from DjmdProperty or similar."""
    db_id: Optional[str] = None
    rb_version: Optional[str] = None
    device_name: Optional[str] = None

    # pyrekordbox exposes DjmdProperty rows that hold key/value pairs for
    # database metadata.  Try the most common attribute paths defensively.
    try:
        if hasattr(db, "get_djmd_property"):
            props = db.get_djmd_property()
        elif hasattr(db, "DjmdProperty"):
            props = list(db.DjmdProperty)
        else:
            props = []

        for row in props:
            key = _safe_get(row, "PropertyName") or _safe_get(row, "Key") or ""
            val = _safe_get(row, "PropertyValue") or _safe_get(row, "Value") or ""
            key_lower = str(key).lower()
            if "uuid" in key_lower or "deviceid" in key_lower or "database_id" in key_lower:
                db_id = str(val)
            elif "version" in key_lower:
                rb_version = str(val)
            elif "devicename" in key_lower or "device_name" in key_lower:
                device_name = str(val)

        if verbose:
            logger.debug(
                "Source info — db_id=%s version=%s device=%s",
                db_id,
                rb_version,
                device_name,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not extract source info: %s", exc)

    return SourceInfo(
        rekordbox_database_id=db_id,
        rekordbox_version=rb_version,
        device_name=device_name,
    )


def _iter_table(db: Any, table_name: str) -> List[Any]:
    """
    Return rows from *table_name* using whichever API pyrekordbox exposes.
    Returns an empty list if the table or method does not exist.
    """
    # Pattern 1: db.get_<table_name>()
    getter_name = f"get_{table_name.lower()}"
    if hasattr(db, getter_name):
        try:
            result = getattr(db, getter_name)()
            return list(result) if result is not None else []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Error calling %s(): %s", getter_name, exc)

    # Pattern 2: db.<TableName> is an iterable / query
    if hasattr(db, table_name):
        try:
            result = getattr(db, table_name)
            # SQLAlchemy InstrumentedList or Query — iterate
            return list(result) if result is not None else []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Error iterating db.%s: %s", table_name, exc)

    logger.warning("Table '%s' not found on database object (dir: %s)", table_name, dir(db))
    return []


def _extract_lists(db: Any, verbose: bool = False) -> List[RelatedTrackList]:
    """
    Extract all DjmdRelatedTracks entries.
    For each non-folder list, extract DjmdSongRelatedTracks members.
    Preserves sort order from the database.
    """
    rows = _iter_table(db, "DjmdRelatedTracks")
    if not rows:
        logger.warning(
            "DjmdRelatedTracks returned no rows — "
            "no Related Tracks data found in this database."
        )
        return []

    result: List[RelatedTrackList] = []
    for row in rows:
        list_id = _safe_get(row, "ID", default=None)
        if list_id is None:
            continue
        list_id = str(list_id)

        parent_id = _safe_get(row, "ParentID", default=None)
        parent_id_str = str(parent_id) if parent_id is not None else None

        name = str(_safe_get(row, "Name", default="") or "")
        sort_order_raw = _safe_get(row, "Seq", default=None)
        sort_order = int(sort_order_raw) if sort_order_raw is not None else None

        # Attribute == 1 typically marks folders in Rekordbox playlist/list tables
        attribute_raw = _safe_get(row, "Attribute", default=0)
        attribute = int(attribute_raw) if attribute_raw is not None else 0
        is_folder = bool(attribute == 1)

        # Preserve whatever criteria columns exist as criteria_raw
        criteria_raw = _build_criteria_raw(row)

        if is_folder:
            members: List[RelatedTrackMember] = []
        else:
            members = _extract_members(db, list_id, verbose=verbose)

        if verbose:
            logger.debug(
                "List id=%s name=%r folder=%s members=%d",
                list_id,
                name,
                is_folder,
                len(members),
            )

        result.append(
            RelatedTrackList(
                source_list_id=list_id,
                parent_source_list_id=parent_id_str,
                name=name,
                sort_order=sort_order,
                is_folder=is_folder,
                attribute=attribute,
                criteria_raw=criteria_raw,
                members=members,
            )
        )

    return result


def _build_criteria_raw(row: Any) -> Dict[str, Any]:
    """
    Build a dict from all non-None columns on *row* that look like criteria.
    Unknown criteria are preserved exactly so they aren't silently lost.
    """
    criteria: Dict[str, Any] = {}
    known_skip = {"ID", "ParentID", "Name", "Seq", "Attribute", "CreatedAt", "UpdatedAt", "UUID"}

    try:
        # SQLAlchemy mapped instances expose __table__.columns
        table = getattr(type(row), "__table__", None)
        if table is not None:
            for col in table.columns:
                if col.name in known_skip:
                    continue
                val = getattr(row, col.name, None)
                if val is not None:
                    criteria[col.name] = val
            return criteria
    except Exception:  # noqa: BLE001
        pass

    # Fallback: try __dict__ (works for simple objects / mocks)
    try:
        for k, v in vars(row).items():
            if k.startswith("_") or k in known_skip:
                continue
            if v is not None:
                criteria[k] = v
    except TypeError:
        pass

    return criteria


def _extract_members(db: Any, list_id: str, verbose: bool = False) -> List[RelatedTrackMember]:
    """
    Query DjmdSongRelatedTracks for members of list_id.
    Returns members ordered by position / sort order.
    """
    all_rows = _iter_table(db, "DjmdSongRelatedTracks")
    members: List[RelatedTrackMember] = []

    for row in all_rows:
        row_list_id = _safe_get(row, "RelatedTracksID", default=None)
        if row_list_id is None:
            row_list_id = _safe_get(row, "PlaylistID", default=None)
        if str(row_list_id) != list_id:
            continue

        content_id = _safe_get(row, "ContentID", default=None)
        if content_id is None:
            continue

        position_raw = (
            _safe_get(row, "TrackNo", default=None)
            or _safe_get(row, "Seq", default=None)
            or 0
        )
        try:
            position = int(position_raw)
        except (TypeError, ValueError):
            position = 0

        # Collect all remaining columns as source_payload for traceability
        source_payload: Dict[str, Any] = {}
        try:
            table = getattr(type(row), "__table__", None)
            if table is not None:
                for col in table.columns:
                    val = getattr(row, col.name, None)
                    if val is not None:
                        source_payload[col.name] = val
        except Exception:  # noqa: BLE001
            try:
                for k, v in vars(row).items():
                    if not k.startswith("_") and v is not None:
                        source_payload[k] = v
            except TypeError:
                pass

        members.append(
            RelatedTrackMember(
                master_content_id=str(content_id),
                position=position,
                source_payload=source_payload,
            )
        )

    # Sort by position (1-based)
    members.sort(key=lambda m: m.position)

    # Re-number to ensure 1-based contiguous positions if DB has gaps
    for i, m in enumerate(members, start=1):
        m.position = i

    if verbose:
        logger.debug("Members for list %s: %d rows", list_id, len(members))

    return members
