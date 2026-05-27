#!/usr/bin/env python3
"""
Post-import verification: confirm that the most-recent completed import
for DROPDEX_OWNER_USER_ID has the expected row counts.

Run after a successful --import-to-supabase to validate Supabase state.

Usage:
  python verify_import.py
  python verify_import.py --import-id <uuid>   # check a specific import

Exit code 0 = all checks passed, 1 = one or more checks failed.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

EXPECTED_TRACKS = 2192
EXPECTED_PLAYLISTS = 12
EXPECTED_PLACEMENTS = 3965


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Verify DropDex Supabase import counts.")
    p.add_argument("--import-id", metavar="UUID", help="Specific import UUID to check.")
    return p


def main() -> int:
    args = _build_parser().parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    owner_user_id = os.environ.get("DROPDEX_OWNER_USER_ID", "").strip()

    missing = [n for n, v in [
        ("SUPABASE_URL", supabase_url),
        ("SUPABASE_SECRET_KEY", supabase_key),
        ("DROPDEX_OWNER_USER_ID", owner_user_id),
    ] if not v]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("supabase package not installed. Run: pip install -r requirements.txt", file=sys.stderr)
        return 1

    sb = create_client(supabase_url, supabase_key)
    sep = "─" * 62
    all_ok = True

    # ── 1. Find the import row ────────────────────────────────────────────────
    if args.import_id:
        resp = (
            sb.table("rekordbox_imports")
            .select("id,status,track_count,playlist_count,playlist_track_count,imported_at")
            .eq("id", args.import_id)
            .execute()
        )
    else:
        resp = (
            sb.table("rekordbox_imports")
            .select("id,status,track_count,playlist_count,playlist_track_count,imported_at")
            .eq("user_id", owner_user_id)
            .eq("status", "completed")
            .order("imported_at", desc=True)
            .limit(1)
            .execute()
        )

    if not resp.data:
        print("No completed import found for this user.", file=sys.stderr)
        return 1

    row = resp.data[0]
    import_id = row["id"]

    print()
    print(sep)
    print(f"  Import ID  : {import_id}")
    print(f"  Imported   : {row['imported_at']}")
    print(f"  Status     : {row['status']}")
    print(sep)

    def check(label: str, actual: int, expected: int) -> None:
        nonlocal all_ok
        status = "PASS" if actual == expected else "FAIL"
        if actual != expected:
            all_ok = False
        print(f"  {status}  {label:<38} expected={expected:>5,}  actual={actual:>5,}")

    # ── 2. Counts stored in the import row ────────────────────────────────────
    print()
    print("  Import row stored counts:")
    check("track_count", row["track_count"], EXPECTED_TRACKS)
    check("playlist_count", row["playlist_count"], EXPECTED_PLAYLISTS)
    check("playlist_track_count", row["playlist_track_count"], EXPECTED_PLACEMENTS)

    # ── 3. Actual row counts in child tables ──────────────────────────────────
    track_resp = (
        sb.table("rekordbox_tracks")
        .select("id", count="exact")
        .eq("import_id", import_id)
        .execute()
    )
    playlist_resp = (
        sb.table("rekordbox_playlists")
        .select("id", count="exact")
        .eq("import_id", import_id)
        .execute()
    )
    # playlist_tracks requires joining via playlists
    playlist_ids_resp = (
        sb.table("rekordbox_playlists")
        .select("id")
        .eq("import_id", import_id)
        .execute()
    )
    pl_ids = [r["id"] for r in playlist_ids_resp.data]
    pt_resp = (
        sb.table("rekordbox_playlist_tracks")
        .select("playlist_id", count="exact")
        .in_("playlist_id", pl_ids)
        .execute()
    )

    print()
    print("  Actual child-table row counts:")
    check("rekordbox_tracks rows", track_resp.count or 0, EXPECTED_TRACKS)
    check("rekordbox_playlists rows", playlist_resp.count or 0, EXPECTED_PLAYLISTS)
    check("rekordbox_playlist_tracks rows", pt_resp.count or 0, EXPECTED_PLACEMENTS)

    # ── 4. Spot-check: position ordering in largest playlist ──────────────────
    if pl_ids:
        pl_sample_resp = (
            sb.table("rekordbox_playlists")
            .select("id,name")
            .eq("import_id", import_id)
            .eq("is_folder", False)
            .execute()
        )
        if pl_sample_resp.data:
            # Pick the first playable playlist
            sample_pl = pl_sample_resp.data[0]
            pt_sample = (
                sb.table("rekordbox_playlist_tracks")
                .select("position")
                .eq("playlist_id", sample_pl["id"])
                .order("position")
                .execute()
            )
            positions = [r["position"] for r in pt_sample.data]
            expected_positions = list(range(1, len(positions) + 1))
            pos_ok = positions == expected_positions
            status = "PASS" if pos_ok else "FAIL"
            if not pos_ok:
                all_ok = False
            print()
            print(f"  Position ordering check (playlist: {sample_pl['name']!r}):")
            print(f"  {status}  Positions are gapless 1-based integers (n={len(positions)})")

    # ── 5. Summary ────────────────────────────────────────────────────────────
    print()
    print(sep)
    if all_ok:
        print("  All checks PASSED.")
    else:
        print("  One or more checks FAILED — see details above.")
    print(sep)
    print()

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
