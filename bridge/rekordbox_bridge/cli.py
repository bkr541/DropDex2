"""Command-line interface for the Rekordbox bridge."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

from .discovery import resolve_db_path
from .extractor import extract_related_tracks
from .models import PAYLOAD_SCHEMA_VERSION
from .security import readonly_snapshot
from .uploader import get_token_from_env, upload_payload


def _warn(message: str) -> None:
    """Print a warning to stderr."""
    print(f"WARNING: {message}", file=sys.stderr)


def _info(message: str) -> None:
    """Print an informational message to stderr."""
    print(message, file=sys.stderr)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rekordbox_bridge",
        description="Extract Rekordbox Related Tracks and upload to DropDex",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── export subcommand ──────────────────────────────────────────────────────
    exp = sub.add_parser("export", help="Export Related Tracks to a JSON file")
    exp.add_argument(
        "--db-path",
        metavar="PATH",
        default=None,
        help="Path to master.db (auto-discovered if omitted)",
    )
    exp.add_argument(
        "--output",
        "-o",
        metavar="FILE",
        default="related-tracks.json",
        help="Output JSON file path (default: related-tracks.json)",
    )
    exp.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract data but do not write any files",
    )
    exp.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    # ── upload subcommand ──────────────────────────────────────────────────────
    upl = sub.add_parser("upload", help="Upload Related Tracks to DropDex backend")
    upl.add_argument(
        "--db-path",
        metavar="PATH",
        default=None,
        help="Path to master.db (auto-discovered if omitted)",
    )
    upl.add_argument(
        "--api-url",
        required=True,
        metavar="URL",
        help="DropDex backend base URL (e.g. https://api.dropdex.app)",
    )
    upl.add_argument(
        "--import-id",
        required=True,
        metavar="ID",
        help="Import session ID from DropDex",
    )
    upl.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract data but do not upload anything",
    )
    upl.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """
    Entry point.
    Returns exit code (0 = success, 1 = error).
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Safety reminder — Rekordbox locks the database while running
    _info("Please close Rekordbox before running the bridge.")

    try:
        db_path = resolve_db_path(getattr(args, "db_path", None))
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.verbose:
        _info(f"Using database: {db_path}")

    try:
        with readonly_snapshot(db_path) as snap:
            if args.verbose:
                _info(f"Snapshot created at: {snap}")

            try:
                payload = extract_related_tracks(snap, verbose=args.verbose)
            except ImportError as exc:
                print(f"ERROR: {exc}", file=sys.stderr)
                return 1
            except RuntimeError as exc:
                print(f"ERROR: {exc}", file=sys.stderr)
                return 1

            _info(
                f"Extracted {len(payload.lists)} list(s) "
                f"(schema version {payload.schema_version})"
            )

            if args.command == "export":
                return _handle_export(args, payload)
            elif args.command == "upload":
                return _handle_upload(args, payload)
            else:
                print(f"ERROR: Unknown command '{args.command}'", file=sys.stderr)
                return 1

    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Unexpected error — {exc}", file=sys.stderr)
        return 1


def _handle_export(args: argparse.Namespace, payload) -> int:
    """Handle the export subcommand."""
    if args.dry_run:
        _info("[dry-run] Would write JSON to: " + args.output)
        # Print a summary to stdout so callers can verify output
        summary = {
            "schemaVersion": payload.schema_version,
            "generatedAt": payload.generated_at,
            "listCount": len(payload.lists),
        }
        print(json.dumps(summary, indent=2))
        return 0

    output_path = Path(args.output)
    try:
        with output_path.open("w", encoding="utf-8") as fh:
            json.dump(payload.to_dict(), fh, indent=2, ensure_ascii=False)
        _info(f"Written to: {output_path.resolve()}")
        return 0
    except OSError as exc:
        print(f"ERROR: Could not write output file: {exc}", file=sys.stderr)
        return 1


def _handle_upload(args: argparse.Namespace, payload) -> int:
    """Handle the upload subcommand."""
    # Token comes from env only — never from argv
    try:
        token = get_token_from_env()
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        _info("[dry-run] Would upload to: " + args.api_url)
        _info(f"[dry-run] Import ID: {args.import_id}")
        _info(f"[dry-run] Lists to upload: {len(payload.lists)}")
        return 0

    try:
        result = upload_payload(
            payload=payload,
            api_url=args.api_url,
            import_id=args.import_id,
            token=token,
        )
        _info("Upload successful.")
        if args.verbose:
            _info(f"Server response: {json.dumps(result, indent=2)}")
        return 0
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
