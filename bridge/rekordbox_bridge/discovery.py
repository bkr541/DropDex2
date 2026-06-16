"""Locate the Rekordbox master.db on the current platform."""
from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Optional


def find_master_db() -> Optional[Path]:
    """
    Return the first existing master.db path for the current platform.
    Returns None if not found.

    macOS:   ~/Library/Pioneer/rekordbox/master.db
    Windows: %LOCALAPPDATA%\\Pioneer\\rekordbox\\master.db
             C:\\Users\\<user>\\AppData\\Roaming\\Pioneer\\rekordbox\\master.db
    """
    system = platform.system()

    if system == "Darwin":
        candidates = [
            Path.home() / "Library" / "Pioneer" / "rekordbox" / "master.db",
        ]
    elif system == "Windows":
        candidates = []
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(
                Path(local_app_data) / "Pioneer" / "rekordbox" / "master.db"
            )
        roaming = os.environ.get("APPDATA")
        if roaming:
            candidates.append(
                Path(roaming) / "Pioneer" / "rekordbox" / "master.db"
            )
        # Fallback hard-coded path
        home = Path.home()
        candidates.append(
            home / "AppData" / "Roaming" / "Pioneer" / "rekordbox" / "master.db"
        )
    else:
        # Linux / other: not officially supported but try a reasonable guess
        candidates = [
            Path.home() / ".local" / "share" / "Pioneer" / "rekordbox" / "master.db",
        ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


def resolve_db_path(explicit_path: Optional[str]) -> Path:
    """
    Return Path to master.db.

    If *explicit_path* is given, return that path (raising FileNotFoundError if
    it does not exist on disk).  Otherwise auto-discover via find_master_db().
    Raises FileNotFoundError with a helpful message when the path is not found.
    Never modifies the returned path.
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
