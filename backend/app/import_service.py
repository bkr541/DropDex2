"""
Orchestrates the full upload → parse → validate → write → respond lifecycle.

Temp file guarantee: the uploaded bytes are written to a NamedTemporaryFile
(delete=False) that is always removed in a finally block, whether the
import succeeds or fails at any stage.
"""

from __future__ import annotations

import logging
import os
import tempfile
from collections import defaultdict

from fastapi import HTTPException, UploadFile

from .config import settings
from .models import ImportResponse, PlaylistSummary
from .rekordbox_parser import parse_library
from .supabase_writer import write_to_supabase_full
from .user_settings import upsert_active_import
from .validation import validate

logger = logging.getLogger(__name__)


async def run_import(file: UploadFile, user_id: str) -> ImportResponse:
    filename = file.filename or "upload"

    # Only accept .db files
    if not filename.lower().endswith(".db"):
        raise HTTPException(
            status_code=422,
            detail="Only .db files are accepted. Please upload your rekordbox exportLibrary.db file.",
        )

    # Read into memory so we can size-check before touching the filesystem
    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {limit_mb} MB.",
        )

    tmp_path: str | None = None
    try:
        # Write to a private temp file; keep it closed before parsing
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(content)
        # File is closed here; SQLCipher can now open it

        # Parse
        try:
            library = parse_library(tmp_path)
        except ImportError:
            logger.exception("dropdex_importer or its dependencies are not available")
            raise HTTPException(
                status_code=500,
                detail="The server is not configured to parse rekordbox databases. Contact the administrator.",
            )
        except Exception:
            logger.exception("Parser raised an exception for upload from user %s", user_id)
            raise HTTPException(
                status_code=422,
                detail="Could not parse the uploaded file. Please confirm it is a valid rekordbox exportLibrary.db.",
            )

        # Validate referential integrity
        result = validate(library)
        if not result.ok:
            logger.warning(
                "Validation errors for upload from user %s: %s",
                user_id,
                result.errors,
            )
            raise HTTPException(
                status_code=422,
                detail=f"Library validation failed: {'; '.join(result.errors)}",
            )

        if result.warnings:
            logger.info("Validation warnings: %s", result.warnings)

        # Write to Supabase (service-role key, server-side only)
        # user_id comes exclusively from the validated JWT — never from form data
        try:
            write_result = write_to_supabase_full(
                library,
                settings.supabase_url,
                settings.supabase_secret_key,
                user_id,
            )
        except Exception:
            # supabase_writer already marked the import row as 'failed'
            logger.exception("Supabase write failed for user %s", user_id)
            raise HTTPException(
                status_code=500,
                detail="Import encountered a server error. The failure has been recorded. Please try again.",
            )
        import_id = write_result.import_id

        # Mark new import as the user's active import; non-fatal if this fails
        try:
            upsert_active_import(
                settings.supabase_url,
                settings.supabase_secret_key,
                user_id,
                import_id,
            )
        except Exception:
            logger.warning(
                "Failed to set active import for user %s — import still succeeded",
                user_id,
            )

        # Record source bundle type; non-fatal
        try:
            import supabase as _sb  # noqa: PLC0415
            _sb.create_client(
                settings.supabase_url, settings.supabase_secret_key
            ).table("rekordbox_imports").update(
                {"source_bundle_type": "database_only"}
            ).eq("id", import_id).execute()
        except Exception:
            logger.warning("Failed to set source_bundle_type for import %s", import_id)

        # Build compact playlist summary from in-memory data (no extra DB query)
        placement_counts: dict[str, int] = defaultdict(int)
        for pc in library.placements:
            placement_counts[pc.rekordbox_playlist_id] += 1

        playlist_summaries = [
            PlaylistSummary(
                name=p.name,
                track_count=placement_counts.get(p.rekordbox_playlist_id, 0),
            )
            for p in sorted(library.playlists, key=lambda p: (p.sort_order or 0, p.name))
            if not p.is_folder
        ]

        has_analysis = len(library.analysis_manifest) > 0
        return ImportResponse(
            import_id=import_id,
            status="completed",
            source_filename=library.source_filename,
            track_count=len(library.tracks),
            playlist_count=len(library.playlists),
            playlist_track_count=len(library.placements),
            playlists=playlist_summaries,
            analysis_status="awaiting_upload" if has_analysis else "not_requested",
            analysis_expected_track_count=len(library.analysis_manifest),
        )

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            logger.debug("Deleted temp file %s", tmp_path)
