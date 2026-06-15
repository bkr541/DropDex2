"""
Backfill normalized key columns for existing rekordbox_tracks rows.

Reads rows where camelot_key IS NULL and musical_key IS NOT NULL, runs each
through music_keys.parse_key_identity, and writes the four derived columns back
via UPDATE … WHERE id IN (…), grouped by shared key values (at most 24 requests
for all 24 Camelot positions).  Unknown key formats are skipped and counted.

Usage
-----
  cd importer
  python backfill_keys.py                          # backfill all imports
  python backfill_keys.py --import-id <UUID>       # restrict to one import
  python backfill_keys.py --dry-run                # parse only, no writes
  python backfill_keys.py --batch-size 200         # smaller batches

Requirements
------------
SUPABASE_URL and SUPABASE_SECRET_KEY must be available in importer/.env
or the environment.  The service-role key is required to bypass RLS.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import defaultdict
from typing import Iterator, List, Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

_DEFAULT_BATCH = 500


def _chunks(lst: list, n: int) -> Iterator[list]:
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


def backfill(
    supabase_url: str,
    supabase_key: str,
    *,
    dry_run: bool = False,
    batch_size: int = _DEFAULT_BATCH,
    import_id: Optional[str] = None,
) -> None:
    from supabase import create_client
    from dropdex_importer.music_keys import parse_key_identity

    sb = create_client(supabase_url, supabase_key)

    query = (
        sb.table("rekordbox_tracks")
        .select("id,musical_key")
        .is_("camelot_key", "null")
        .not_.is_("musical_key", "null")
    )
    if import_id:
        query = query.eq("import_id", import_id)

    response = query.execute()
    rows = response.data
    logger.info("Found %d track(s) to backfill", len(rows))

    if not rows:
        return

    # Parse all rows and group IDs by their shared key values.
    # This lets us UPDATE all tracks that share a key in a single request
    # (at most 24 requests for all 24 Camelot positions).
    # key_groups: (camelot, normalized_name, tonic, mode) → [id, ...]
    key_groups: dict[tuple, list] = defaultdict(list)
    total_skipped = 0

    for row in rows:
        identity = parse_key_identity(row["musical_key"])
        if not identity.parsed:
            total_skipped += 1
            continue
        group_key = (
            identity.camelot_key,
            identity.normalized_key_name,
            identity.key_tonic,
            identity.key_mode,
        )
        key_groups[group_key].append(row["id"])

    total_updated = sum(len(ids) for ids in key_groups.values())
    logger.info(
        "Parsed: %d to update across %d distinct key(s), %d skipped",
        total_updated, len(key_groups), total_skipped,
    )

    if not dry_run:
        for (camelot, name, tonic, mode), ids in key_groups.items():
            payload = {
                "camelot_key": camelot,
                "normalized_key_name": name,
                "key_tonic": tonic,
                "key_mode": mode,
            }
            # PostgREST IN filter has a practical URL-length limit; chunk the IDs.
            for id_batch in _chunks(ids, batch_size):
                sb.table("rekordbox_tracks").update(payload).in_("id", id_batch).execute()
            logger.info("Updated %d track(s) → %s (%s)", len(ids), camelot, name)

    logger.info(
        "Backfill complete: %d updated, %d skipped (unrecognised key format)%s",
        total_updated,
        total_skipped,
        " (dry-run — no rows written)" if dry_run else "",
    )


def main() -> None:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

    parser = argparse.ArgumentParser(
        description="Backfill rekordbox_tracks normalized key columns"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse keys without writing to Supabase"
    )
    parser.add_argument(
        "--batch-size", type=int, default=_DEFAULT_BATCH,
        help=f"Rows per upsert batch (default {_DEFAULT_BATCH})"
    )
    parser.add_argument(
        "--import-id", default=None,
        help="Restrict backfill to a single import UUID"
    )
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
        sys.exit(1)

    backfill(
        url, key,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        import_id=args.import_id,
    )


if __name__ == "__main__":
    main()
