#!/usr/bin/env python3
"""One-time cleanup: remove orphaned objects from the rekordbox-analysis-assets
Supabase Storage bucket.

Usage (from backend/, with its venv active):
    SUPABASE_DB_PASSWORD=... python scripts/cleanup_orphaned_storage.py --dry-run
    SUPABASE_DB_PASSWORD=... python scripts/cleanup_orphaned_storage.py
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import psycopg2
from supabase import create_client

from app.config import settings

BUCKET = "rekordbox-analysis-assets"
BATCH_SIZE = 100

ORPHAN_QUERY = """
    select o.name
    from storage.objects o
    where o.bucket_id = %s
      and o.created_at < now() - interval '1 day'
      and not exists (
        select 1 from public.rekordbox_analysis_assets a
        where a.storage_path = o.name or a.archive_storage_path = o.name
      )
      and not exists (
        select 1 from public.rekordbox_track_waveforms w
        where w.detail_storage_path = o.name
      )
    order by o.name
"""


def _db_dsn() -> str:
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not password:
        raise SystemExit("Set SUPABASE_DB_PASSWORD, same as you do for `supabase db push`.")
    match = re.match(r"https://([a-z0-9]+)\.supabase\.co", settings.supabase_url)
    if not match:
        raise SystemExit(f"Could not parse project ref from supabase_url={settings.supabase_url!r}")
    return f"postgresql://postgres:{password}@db.{match.group(1)}.supabase.co:5432/postgres"


def fetch_orphan_paths() -> list[str]:
    with psycopg2.connect(_db_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(ORPHAN_QUERY, (BUCKET,))
            return [row[0] for row in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("Enumerating orphaned objects…")
    paths = fetch_orphan_paths()
    print(f"Found {len(paths)} orphaned object(s).")
    if not paths:
        return 0

    if args.dry_run:
        for path in paths[:20]:
            print(f"  {path}")
        if len(paths) > 20:
            print(f"  … and {len(paths) - 20} more")
        print("\nDry run: nothing deleted.")
        return 0

    sb = create_client(settings.supabase_url, settings.supabase_secret_key)
    deleted = 0
    errors: list[str] = []
    for offset in range(0, len(paths), BATCH_SIZE):
        batch = paths[offset : offset + BATCH_SIZE]
        try:
            sb.storage.from_(BUCKET).remove(batch)
            deleted += len(batch)
            print(f"Deleted {deleted}/{len(paths)}…")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            print(f"FAILED batch at offset {offset}: {exc}", file=sys.stderr)

    print(f"\nDone. Deleted {deleted}/{len(paths)} object(s).")
    if errors:
        print(f"{len(errors)} batch(es) failed — safe to re-run.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
