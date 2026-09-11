"""Architecture invariant tests — static assertions about migrations and source files.

These tests lock in forbidden patterns identified during the Rekordbox Cue Points
architecture review so they cannot silently re-enter the codebase.

Section references from the architecture review:
  Req 27, 28  — source_db_present / source_anlz_present provenance
  Req 41      — imported baseline columns are immutable
  Req 47      — cueBaselineVerify issues no token
  Req 54–60   — forbidden patterns (tolerance, nearest, XML, start_ms uniqueness, title, fabricated ID)
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"


def _all_migration_sql() -> str:
    return "\n".join(
        p.read_text(encoding="utf-8")
        for p in sorted(MIGRATIONS_DIR.glob("*.sql"))
    )


# ---------------------------------------------------------------------------
# Req 56 — no (track_id, start_ms) uniqueness constraint
# ---------------------------------------------------------------------------

def test_no_uniqueness_constraint_on_track_id_and_start_ms():
    """Memory Cues and Hot Cues may share a timestamp; a unique constraint on
    (track_id, start_ms) would incorrectly reject them."""
    combined = _all_migration_sql()
    assert not re.search(
        r"unique\s*\(.*track_id.*start_ms|unique\s*\(.*start_ms.*track_id",
        combined,
        re.IGNORECASE,
    ), "Found a UNIQUE constraint pairing track_id with start_ms — this is forbidden."
    assert not re.search(
        r"create\s+unique\s+index\s+\w+\s+on\s+\w+\s*\(.*start_ms",
        combined,
        re.IGNORECASE,
    ), "Found a CREATE UNIQUE INDEX on start_ms — this is forbidden."


# ---------------------------------------------------------------------------
# Req 27, 28, 60 — source_db_present defaults to false; ANLZ-only cues are valid
# ---------------------------------------------------------------------------

def test_source_db_present_column_defaults_to_false():
    """source_db_present=false is the default; ANLZ-only cues must not be forced true."""
    combined = _all_migration_sql()
    # Column must exist
    assert "source_db_present" in combined
    # Default must be false — ANLZ-only cues start without DB evidence
    assert re.search(
        r"source_db_present\s+boolean\s+not\s+null\s+default\s+false",
        combined,
        re.IGNORECASE,
    ), "source_db_present default must be false; ANLZ-only cues have no DB evidence."


def test_source_anlz_present_column_exists():
    """source_anlz_present must be persisted to distinguish ANLZ provenance."""
    combined = _all_migration_sql()
    assert "source_anlz_present" in combined


# ---------------------------------------------------------------------------
# Req 41 — imported baseline columns are never touched by the verify RPC
# ---------------------------------------------------------------------------

def test_verify_rpc_does_not_modify_imported_baseline_columns():
    """update_cue_baseline_fingerprint must only write current_baseline_local_cue_fingerprint."""
    verify_sql = (
        MIGRATIONS_DIR / "20260912010000_cue_baseline_verify_stage11.sql"
    ).read_text(encoding="utf-8")
    assert "current_baseline_local_cue_fingerprint" in verify_sql
    assert "imported_baseline_local_cue_fingerprint" not in verify_sql, (
        "verify RPC must not touch imported_baseline_local_cue_fingerprint"
    )
    assert "imported_baseline_fingerprint" not in verify_sql, (
        "verify RPC must not touch imported_baseline_fingerprint"
    )


# ---------------------------------------------------------------------------
# Req 47 — cueBaselineVerify is read-only and issues no write token
# ---------------------------------------------------------------------------

def test_verify_cue_baseline_function_issues_no_token():
    """verify_cue_baseline must be read-only — it may not call store.issue or return a token."""
    apply_service = (
        REPO_ROOT / "bridge" / "rekordbox_bridge" / "apply_service.py"
    ).read_text(encoding="utf-8")
    assert "def verify_cue_baseline" in apply_service

    # Extract only the verify_cue_baseline function body to avoid false positives
    # from other functions in the same file.
    start = apply_service.index("def verify_cue_baseline")
    after = apply_service[start + len("def verify_cue_baseline"):]
    # The next top-level function definition ends this body
    m = re.search(r"\ndef \w", after)
    body = after[: m.start()] if m else after

    assert ".issue(" not in body, (
        "verify_cue_baseline must not call store.issue — it is a read-only observation"
    )


# ---------------------------------------------------------------------------
# Req 54, 55 — tolerance and nearest matching are absent from production paths
# ---------------------------------------------------------------------------

def test_cue_match_tolerance_symbol_absent():
    """CUE_MATCH_TOLERANCE must not exist — cue identity uses exact semantics."""
    for path in (REPO_ROOT / "importer").rglob("*.py"):
        if "__pycache__" in str(path):
            continue
        src = path.read_text(encoding="utf-8")
        assert "CUE_MATCH_TOLERANCE" not in src, (
            f"CUE_MATCH_TOLERANCE found in {path} — forbidden tolerance symbol"
        )


def test_no_nearest_cue_matching_in_importer():
    """Nearest-cue matching is forbidden in cue identity logic."""
    importer_src = (REPO_ROOT / "importer" / "dropdex_importer" / "cue_parser.py").read_text(
        encoding="utf-8"
    )
    assert "nearest" not in importer_src.lower(), (
        "cue_parser.py contains 'nearest' — nearest-cue matching is forbidden"
    )


# ---------------------------------------------------------------------------
# Req 57 — no XML TrackID association in importer
# ---------------------------------------------------------------------------

def test_no_xml_trackid_cue_import_in_importer():
    """Cue identity must not be derived from rekordbox.xml TrackID."""
    importer_src = (REPO_ROOT / "importer" / "dropdex_importer" / "cue_parser.py").read_text(
        encoding="utf-8"
    )
    assert "rekordbox.xml" not in importer_src.lower()
    assert "trackid" not in importer_src.lower()


# ---------------------------------------------------------------------------
# Req 59 — no fabricated Rekordbox cue IDs
# ---------------------------------------------------------------------------

def test_anlz_only_cue_entry_has_no_rekordbox_cue_id():
    """AnlzCueEntry must not carry a fabricated rekordbox_cue_id field."""
    import sys
    if str(REPO_ROOT / "importer") not in sys.path:
        sys.path.insert(0, str(REPO_ROOT / "importer"))
    from dropdex_importer.cue_parser import AnlzCueEntry
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(AnlzCueEntry)}
    assert "rekordbox_cue_id" not in field_names, (
        "AnlzCueEntry must not have a rekordbox_cue_id — IDs must come from live master.db only"
    )
