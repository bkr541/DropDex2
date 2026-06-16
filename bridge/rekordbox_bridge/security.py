"""Safe temporary snapshot of master.db — never modifies the source."""
from __future__ import annotations

import shutil
import stat
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


@contextmanager
def readonly_snapshot(source_path: Path) -> Iterator[Path]:
    """
    Copy *source_path* to a new temporary file and yield the temp path.

    Safety guarantees:
    - Never modifies source_path.
    - Never uploads the snapshot (caller's responsibility).
    - Snapshot is deleted before this function returns (finally block).
    - Symlinks in source_path are not followed blindly — os.stat() the real
      file first so we know what we're copying.
    - Temp file is opened read-only (mode 0o400) after copy.
    """
    # Resolve the source so we don't blindly follow symlinks without checking.
    # Path.stat() follows the final symlink, which is the correct behaviour for
    # an ordinary file — we just want to ensure it's a regular file, not a
    # device node or directory.
    src_stat = source_path.stat()
    if not stat.S_ISREG(src_stat.st_mode):
        raise ValueError(
            f"source_path must be a regular file, got: {source_path}"
        )

    # mktemp gives us a name without creating the file, which is fine because
    # shutil.copy2 will create it.  We stay within the system temp dir.
    tmp = tempfile.mktemp(suffix=".db", prefix="dropdex_bridge_")
    try:
        shutil.copy2(str(source_path), tmp)
        tmp_path = Path(tmp)
        tmp_path.chmod(0o400)  # read-only for owner; no write, no execute
        yield tmp_path
    finally:
        try:
            Path(tmp).unlink(missing_ok=True)
        except OSError:
            pass
