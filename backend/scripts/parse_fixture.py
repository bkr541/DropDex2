#!/usr/bin/env python3
"""
Developer convenience script: parse a saved HTML fixture and print a summary.

Usage:
    python scripts/parse_fixture.py path/to/page.html
    python scripts/parse_fixture.py path/to/page.html --json

Does NOT launch Chromium, hit the network, or write to Supabase.
Requires: selectolax (available when the backend venv is active).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running from the repo root without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.discovery.scrapers.tracklists1001.parser import parse_result_page


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("fixture", help="Path to a saved HTML file")
    parser.add_argument("--json", action="store_true", help="Dump full parsed results as JSON")
    args = parser.parse_args()

    fixture_path = Path(args.fixture)
    if not fixture_path.exists():
        print(f"Error: file not found: {fixture_path}", file=sys.stderr)
        sys.exit(1)

    html = fixture_path.read_text(encoding="utf-8", errors="replace")
    page = parse_result_page(html)

    if args.json:
        import dataclasses
        print(json.dumps(
            {
                "query_text": page.query_text,
                "reported_total_results": page.reported_total_results,
                "current_page": page.current_page,
                "has_next_page": page.has_next_page,
                "next_page_number": page.next_page_number,
                "results": [dataclasses.asdict(r) for r in page.results],
            },
            indent=2,
            default=str,
        ))
        return

    print(f"File:              {fixture_path}")
    print(f"Query:             {page.query_text!r}")
    print(f"Reported total:    {page.reported_total_results}")
    print(f"Current page:      {page.current_page}")
    print(f"Has next page:     {page.has_next_page}  (next={page.next_page_number})")
    print(f"Cards parsed:      {len(page.results)}")

    if not page.results:
        print("\nNo results parsed.")
        return

    print("\n── Results ──────────────────────────────────────────────────────────────")
    for i, r in enumerate(page.results, start=1):
        tracks = (
            f"{r.ided_tracks}/{r.total_tracks}"
            if r.ided_tracks is not None
            else str(r.total_tracks or "?")
        )
        print(
            f"  [{i:>2}] {r.source_tracklist_id:<12}  {r.set_date or '????-??-??'}  "
            f"tracks={tracks:<8}  {r.title[:55]}"
        )


if __name__ == "__main__":
    main()
