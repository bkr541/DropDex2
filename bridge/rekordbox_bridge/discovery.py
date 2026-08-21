"""Locate the Rekordbox master.db on the current platform."""
from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Optional


def candidate_master_db_paths(system: Optional[str] = None) -> list[Path]:
    """Return trusted, application-owned discovery candidates for ``master.db``.

    This list is deliberately internal and contains no renderer/user supplied path.
    The read-only bridge may still use :func:`resolve_db_path` with an explicit path;
    write-capable code must use ``find_master_db`` plus the Stage 5 target guard.
    """
    system = system or platform.system()

    if system == "Darwin":
        return [Path.home() / "Library" / "Pioneer" / "rekordbox" / "master.db"]

    if system == "Windows":
        candidates: list[Path] = []
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(Path(local_app_data) / "Pioneer" / "rekordbox" / "master.db")
        roaming = os.environ.get("APPDATA")
        if roaming:
            candidates.append(Path(roaming) / "Pioneer" / "rekordbox" / "master.db")
        fallback = Path.home() / "AppData" / "Roaming" / "Pioneer" / "rekordbox" / "master.db"
        if fallback not in candidates:
            candidates.append(fallback)
        return candidates

    # Kept for the existing read-only bridge. Stage 5 write safety treats
    # unsupported platforms as unknown/unsafe and will not mutate anything.
    return [Path.home() / ".local" / "share" / "Pioneer" / "rekordbox" / "master.db"]


def find_master_db() -> Optional[Path]:
    """Return the first existing trusted discovery candidate, or ``None``."""
    for candidate in candidate_master_db_paths():
        if candidate.exists():
            return candidate
    return None


def resolve_db_path(explicit_path: Optional[str]) -> Path:
    """
    Return Path to master.db for the existing **read-only** bridge.

    If *explicit_path* is given, return that path (raising FileNotFoundError if
    it does not exist on disk). Otherwise auto-discover via find_master_db().
    Writer code must never call this function with renderer/user input.
    """
    if explicit_path is not None:
        p = Path(explicit_path)
        if not p.exists():
            raise FileNotFoundError(
                f"Specified master.db path does not exist: {p}\n"
                "Please verify the path and try again."
            )
        return p

    found = find_master_db()
    if found is None:
        raise FileNotFoundError(
            "Could not find master.db automatically.\n"
            "Please specify the path with --db-path.\n"
            "Common locations:\n"
            "  macOS:   ~/Library/Pioneer/rekordbox/master.db\n"
            "  Windows: %LOCALAPPDATA%\\Pioneer\\rekordbox\\master.db"
        )
    return found
