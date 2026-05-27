#!/usr/bin/env python3
"""
DropDex — rekordbox exportLibrary.db importer.

Usage examples
--------------
  # Verify the database parses correctly without touching Supabase:
  python import_export_library.py --file /path/to/exportLibrary.db --dry-run

  # Import into Supabase (requires .env):
  python import_export_library.py --file /path/to/exportLibrary.db --import-to-supabase

  # Remove the latest failed import then re-import:
  python import_export_library.py --file /path/to/exportLibrary.db \\
      --import-to-supabase --replace-latest-failed

  # Verbose logging:
  python import_export_library.py --file /path/to/exportLibrary.db --dry-run --verbose
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Load .env from the importer/ directory before any other imports
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from dropdex_importer.models import ParsedLibrary
from dropdex_importer.parser import parse_library
from dropdex_importer.validation import ValidationResult, validate


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-8s %(message)s",
    )


# ── Output formatting ─────────────────────────────────────────────────────────


def _print_summary(library: ParsedLibrary, v: ValidationResult) -> None:
    sep = "─" * 62
    print()
    print(sep)
    print(f"  Source file   : {library.source_filename}")
    if library.device_name:
        print(f"  Device        : {library.device_name}")
    if library.database_version:
        print(f"  DB version    : {library.database_version}")
    if library.rekordbox_created_date:
        print(f"  Created       : {library.rekordbox_created_date}")
    print()
    print(f"  Tracks        : {v.track_count:>6,}")
    playable = v.playlist_count - v.folder_count
    print(
        f"  Playlists     : {v.playlist_count:>6,}"
        f"  ({playable} playable, {v.folder_count} folders)"
    )
    print(f"  Placements    : {v.placement_count:>6,}")
    print(sep)

    # Playable playlists with their track counts
    placement_counts: dict[str, int] = {}
    for pc in library.placements:
        placement_counts[pc.rekordbox_playlist_id] = (
            placement_counts.get(pc.rekordbox_playlist_id, 0) + 1
        )

    playable_playlists = [p for p in library.playlists if not p.is_folder]
    if playable_playlists:
        print()
        print(f"  Playlists (first {min(len(playable_playlists), 10)}):")
        for p in playable_playlists[:10]:
            count = placement_counts.get(p.rekordbox_playlist_id, 0)
            print(f"    {p.name:<42} {count:>4} tracks")

    # Track sample
    if library.tracks:
        print()
        print(f"  Tracks (first {min(len(library.tracks), 5)}):")
        for t in library.tracks[:5]:
            bpm_str = f"{t.bpm:.1f}" if t.bpm is not None else "—"
            key_str = t.musical_key or "—"
            title = (t.title or "")[:34]
            artist = (t.artist or "")[:22]
            print(
                f"    [{t.rekordbox_content_id:>6}]  "
                f"{title:<34}  {artist:<22}  "
                f"BPM:{bpm_str:>6}  Key:{key_str}"
            )

    # Warnings / errors
    if v.warnings:
        print()
        for w in v.warnings:
            print(f"  ⚠  {w}")
    if v.errors:
        print()
        for e in v.errors:
            print(f"  ✗  {e}")
    print()


# ── CLI ───────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Import a rekordbox exportLibrary.db file into DropDex / Supabase.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--file",
        required=True,
        metavar="PATH",
        help="Path to the rekordbox exportLibrary.db file.",
    )
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate without writing to Supabase.",
    )
    mode.add_argument(
        "--import-to-supabase",
        action="store_true",
        help="Parse and write all data to Supabase.",
    )
    p.add_argument(
        "--replace-latest-failed",
        action="store_true",
        help=(
            "Before importing, delete the most-recent failed import owned by "
            "DROPDEX_OWNER_USER_ID. Cascading deletes remove related tracks, "
            "playlists, and placements. Has no effect in --dry-run mode. "
            "Completed imports are never touched."
        ),
    )
    p.add_argument(
        "--expected-tracks",
        type=int,
        metavar="N",
        help="Assert that exactly N tracks are parsed; fail if the count differs.",
    )
    p.add_argument(
        "--expected-playlists",
        type=int,
        metavar="N",
        help="Assert that exactly N playlists are parsed; fail if the count differs.",
    )
    p.add_argument(
        "--expected-placements",
        type=int,
        metavar="N",
        help="Assert that exactly N playlist-track placements are parsed; fail if the count differs.",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="Enable DEBUG-level logging.",
    )
    return p


def main() -> int:
    args = _build_parser().parse_args()
    _setup_logging(args.verbose)

    # ── Parse ─────────────────────────────────────────────────────────────────
    print(f"\nParsing {args.file} …")
    try:
        library = parse_library(args.file)
    except FileNotFoundError as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1
    except (ImportError, RuntimeError) as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1

    # ── Validate ──────────────────────────────────────────────────────────────
    v = validate(
        library,
        expected_tracks=args.expected_tracks,
        expected_playlists=args.expected_playlists,
        expected_placements=args.expected_placements,
    )
    _print_summary(library, v)

    if not v.ok:
        print("Validation errors found — aborting.", file=sys.stderr)
        return 1

    # ── Dry run ───────────────────────────────────────────────────────────────
    if args.dry_run:
        print("Dry-run complete — no data was written to Supabase.")
        return 0

    # ── Supabase import ───────────────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    owner_user_id = os.environ.get("DROPDEX_OWNER_USER_ID", "").strip()

    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SECRET_KEY", supabase_key),
            ("DROPDEX_OWNER_USER_ID", owner_user_id),
        ]
        if not val
    ]
    if missing:
        print(
            f"\nError: missing environment variable(s): {', '.join(missing)}\n"
            "Copy importer/.env.example → importer/.env and fill in the values.",
            file=sys.stderr,
        )
        return 1

    from dropdex_importer.supabase_writer import (
        remove_latest_failed_import,
        write_to_supabase,
    )

    try:
        from supabase import create_client
    except ImportError:
        print(
            "Error: supabase package not installed.\n"
            "Run: pip install -r importer/requirements.txt",
            file=sys.stderr,
        )
        return 1

    if args.replace_latest_failed:
        sb = create_client(supabase_url, supabase_key)
        deleted = remove_latest_failed_import(sb, owner_user_id)
        if deleted:
            print(f"Removed failed import: {deleted}")
        else:
            print("No failed import found to remove.")

    print("Writing to Supabase …")
    try:
        import_id = write_to_supabase(library, supabase_url, supabase_key, owner_user_id)
    except Exception as exc:
        print(f"\nImport failed: {exc}", file=sys.stderr)
        return 1

    sep = "─" * 62
    print()
    print(sep)
    print("  Import complete!")
    print(f"  Import ID     : {import_id}")
    print(f"  Tracks        : {len(library.tracks):>6,}")
    print(f"  Playlists     : {len(library.playlists):>6,}")
    print(f"  Placements    : {len(library.placements):>6,}")
    print(sep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
