"""
Thin wrapper around dropdex_importer.supabase_writer.

Import is deferred so this module can be loaded (and mocked) in tests
without requiring the supabase package to be present.
"""

from __future__ import annotations


def write_to_supabase(library, supabase_url: str, supabase_key: str, owner_user_id: str) -> str:
    """Backward-compatible wrapper. Returns only the import UUID string."""
    from dropdex_importer.supabase_writer import write_to_supabase as _write

    result = _write(library, supabase_url, supabase_key, owner_user_id)
    return result.import_id


def write_to_supabase_full(
    library,
    supabase_url: str,
    supabase_key: str,
    owner_user_id: str,
    *,
    import_id: str | None = None,
    finalize_status: str | None = "completed",
    should_cancel=None,
):
    """Full result wrapper. Returns an ImportWriteResult."""
    from dropdex_importer.supabase_writer import write_to_supabase as _write

    return _write(
        library,
        supabase_url,
        supabase_key,
        owner_user_id,
        import_id=import_id,
        finalize_status=finalize_status,
        should_cancel=should_cancel,
    )
